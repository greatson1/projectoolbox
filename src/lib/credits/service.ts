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

    return updated.creditBalance;
  }

  static getCost(action: CreditAction): number {
    return CREDIT_COSTS[action];
  }
}
