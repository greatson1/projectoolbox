"use client";

/**
 * Animated Ring Gauge — circular progress indicator.
 * Used for task completion %, budget burn, days remaining.
 */

interface RingGaugeProps {
  value: number;      // 0-100
  label: string;
  subtitle?: string;
  size?: number;
  strokeWidth?: number;
  showValue?: boolean;
  suffix?: string;
  invertColor?: boolean; // true = lower is better (e.g. risks, budget burn)
}

export function RingGauge({ value, label, subtitle, size = 100, strokeWidth = 6, showValue = true, suffix = "%", invertColor = false }: RingGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  const getColor = () => {
    if (invertColor) {
      if (clamped <= 30) return "#10B981";
      if (clamped <= 70) return "#F59E0B";
      return "#EF4444";
    }
    if (clamped >= 70) return "#10B981";
    if (clamped >= 40) return "#F59E0B";
    return "#EF4444";
  };

  const color = getColor();

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
          {/* Background ring */}
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} opacity={0.2} />
          {/* Progress ring */}
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-1000 ease-out" />
        </svg>
        {showValue && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold" style={{ color }}>{Math.round(clamped)}</span>
            <span className="text-[8px] text-muted-foreground">{suffix}</span>
          </div>
        )}
      </div>
      <p className="text-[11px] font-semibold mt-1.5">{label}</p>
      {subtitle && <p className="text-[9px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
