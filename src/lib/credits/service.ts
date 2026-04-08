import { db } from "@/lib/db";
import { CREDIT_COSTS } from "@/lib/utils";

export type CreditAction = keyof typeof CREDIT_COSTS;

export class CreditService {
  static async checkBalance(orgId: string, required: number): Promise<boolean> {
    const org = await db.organisation.findUnique({
      where: { id: orgId },
      select: { creditBalance: true },
    });
    return (org?.creditBalance || 0) >= required;
  }

  static async deduct(
    orgId: string,
    credits: number,
    description: string,
    agentId?: string
  ): Promise<{ success: boolean; balance: number; error?: string }> {
    // Atomic deduction using transaction
    try {
      const result = await db.$transaction(async (tx) => {
        const org = await tx.organisation.findUnique({
          where: { id: orgId },
          select: { creditBalance: true, autoTopUp: true },
        });

        if (!org || org.creditBalance < credits) {
          throw new Error("Insufficient credits");
        }

        // Deduct
        const updated = await tx.organisation.update({
          where: { id: orgId },
          data: { creditBalance: { decrement: credits } },
        });

        // Record transaction
        await tx.creditTransaction.create({
          data: {
            orgId,
            amount: -credits,
            type: "USAGE",
            description,
            agentId,
          },
        });

        // Check auto top-up threshold
        const autoTopUp = org.autoTopUp as any;
        if (autoTopUp?.enabled && updated.creditBalance <= (autoTopUp.threshold || 200)) {
          // TODO: Trigger Stripe charge for auto top-up
          // For now, just create a notification
        }

        return updated.creditBalance;
      });

      return { success: true, balance: result };
    } catch (e: any) {
      return { success: false, balance: 0, error: e.message };
    }
  }

  static async grant(
    orgId: string,
    credits: number,
    type: "PURCHASE" | "SUBSCRIPTION_GRANT" | "BONUS",
    description: string,
    stripePaymentId?: string
  ): Promise<number> {
    const updated = await db.organisation.update({
      where: { id: orgId },
      data: { creditBalance: { increment: credits } },
    });

    await db.creditTransaction.create({
      data: {
        orgId,
        amount: credits,
        type,
        description,
        stripePaymentId,
      },
    });

    // Auto-resume any budget-blocked proposals for all agents in this org.
    // Dynamic import breaks the circular dep: action-executor → CreditService → action-executor.
    // Fire-and-forget — don't let resume failures affect the grant response.
    import("@/lib/agents/action-executor").then(({ resumeBlockedProposals }) => {
      db.agent.findMany({ where: { orgId }, select: { id: true } }).then((agents) => {
        for (const agent of agents) {
          resumeBlockedProposals(agent.id).catch(() => {});
        }
      }).catch(() => {});
    }).catch(() => {});

    return updated.creditBalance;
  }

  static getCost(action: CreditAction): number {
    return CREDIT_COSTS[action];
  }

  /**
   * Check if an agent is within its monthly credit budget.
   */
  static async checkAgentBudget(
    agentId: string,
    orgId: string,
    cost: number,
  ): Promise<{ allowed: boolean; monthlyUsed: number; monthlyBudget: number | null; orgBalance: number }> {
    const [agent, org, monthlyUsage] = await Promise.all([
      db.agent.findUnique({ where: { id: agentId }, select: { monthlyBudget: true } }),
      db.organisation.findUnique({ where: { id: orgId }, select: { creditBalance: true } }),
      this.getAgentMonthlyUsage(agentId),
    ]);

    const orgBalance = org?.creditBalance || 0;
    const monthlyBudget = agent?.monthlyBudget || null;

    // Org-level check
    if (orgBalance < cost) {
      return { allowed: false, monthlyUsed: monthlyUsage, monthlyBudget, orgBalance };
    }

    // Agent monthly budget check
    if (monthlyBudget !== null && monthlyUsage + cost > monthlyBudget) {
      return { allowed: false, monthlyUsed: monthlyUsage, monthlyBudget, orgBalance };
    }

    return { allowed: true, monthlyUsed: monthlyUsage, monthlyBudget, orgBalance };
  }

  /**
   * Get total credits used by an agent this calendar month.
   */
  static async getAgentMonthlyUsage(agentId: string): Promise<number> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const result = await db.creditTransaction.aggregate({
      where: { agentId, type: "USAGE", createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });

    return Math.abs(result._sum.amount || 0);
  }

  /**
   * Check agent budget thresholds and create alerts if needed.
   * Called after each deduction.
   */
  static async checkBudgetAlerts(agentId: string, orgId: string): Promise<void> {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { name: true, monthlyBudget: true },
    });
    if (!agent?.monthlyBudget) return;

    const usage = await this.getAgentMonthlyUsage(agentId);
    const pctUsed = Math.round((usage / agent.monthlyBudget) * 100);
    const remaining = agent.monthlyBudget - usage;

    // Alert thresholds: 80%, 90%, 95%
    const thresholds = [
      { pct: 95, type: "BILLING" as const, title: `Agent ${agent.name}: credit budget critical (${pctUsed}% used)` },
      { pct: 90, type: "BILLING" as const, title: `Agent ${agent.name}: credit budget warning (${pctUsed}% used)` },
      { pct: 80, type: "BILLING" as const, title: `Agent ${agent.name}: credit budget at ${pctUsed}%` },
    ];

    for (const threshold of thresholds) {
      if (pctUsed >= threshold.pct) {
        // Check if we already sent this alert this month
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const existing = await db.notification.count({
          where: {
            type: threshold.type,
            title: { contains: `${threshold.pct}%` },
            metadata: { path: ["agentId"], equals: agentId },
            createdAt: { gte: monthStart },
          },
        });

        if (existing === 0) {
          // Send to all admins
          const admins = await db.user.findMany({
            where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
            select: { id: true },
          });
          for (const admin of admins) {
            await db.notification.create({
              data: {
                userId: admin.id,
                type: threshold.type,
                title: threshold.title,
                body: `Agent ${agent.name} has used ${usage}/${agent.monthlyBudget} credits this month (${remaining} remaining).`,
                actionUrl: "/billing/credits",
                metadata: { agentId, pctUsed, remaining },
              },
            });
          }

          // At 95%, pause non-essential autonomous actions
          if (threshold.pct >= 95) {
            await db.agentActivity.create({
              data: {
                agentId,
                type: "budget_limit",
                summary: `Monthly budget at ${pctUsed}%. Autonomous actions paused — only reactive queries allowed.`,
              },
            });
          }
        }
        break; // Only send the highest threshold alert
      }
    }
  }
}
