import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  icon?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions, className, icon }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl px-6 py-5 mb-6 overflow-hidden border border-primary/15",
        className
      )}
      style={{
        background: "linear-gradient(135deg, var(--primary)18 0%, transparent 60%)",
      }}
    >
      {/* Subtle radial glow top-right */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse 60% 80% at 100% 0%, var(--primary) 0%, transparent 70%)",
        }}
      />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary flex-shrink-0">
              {icon}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">{title}</h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
