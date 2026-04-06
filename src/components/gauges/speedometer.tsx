"use client";

/**
 * Speedometer Gauge — animated needle SVG gauge with color zones.
 * Used for SPI, CPI, and other performance indices.
 *
 * Props:
 *   value: 0-2 (1.0 = target, >1 = good, <1 = bad)
 *   label: "SPI" | "CPI" etc
 *   subtitle: "Schedule Performance"
 *   size: pixel width/height
 */

interface SpeedometerProps {
  value: number;
  label: string;
  subtitle?: string;
  size?: number;
  min?: number;
  max?: number;
  target?: number;
}

export function Speedometer({ value, label, subtitle, size = 180, min = 0, max = 2, target = 1 }: SpeedometerProps) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min);
  const angle = -135 + pct * 270; // -135° to +135° sweep

  // Color zones
  const getColor = (v: number) => {
    if (v >= target) return "#10B981"; // Green
    if (v >= target * 0.9) return "#F59E0B"; // Amber
    return "#EF4444"; // Red
  };

  const color = getColor(value);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  // Arc path helper
  const arcPath = (startAngle: number, endAngle: number, radius: number) => {
    const s = (startAngle * Math.PI) / 180;
    const e = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(s);
    const y1 = cy + radius * Math.sin(s);
    const x2 = cx + radius * Math.cos(e);
    const y2 = cy + radius * Math.sin(e);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };

  // Needle endpoint
  const needleAngle = (angle * Math.PI) / 180;
  const needleLen = r * 0.85;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy + needleLen * Math.sin(needleAngle);

  // Tick marks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const a = ((-135 + t * 270) * Math.PI) / 180;
    const tickVal = min + t * (max - min);
    return {
      x1: cx + (r + 4) * Math.cos(a),
      y1: cy + (r + 4) * Math.sin(a),
      x2: cx + (r + 12) * Math.cos(a),
      y2: cy + (r + 12) * Math.sin(a),
      label: tickVal.toFixed(1),
      lx: cx + (r + 22) * Math.cos(a),
      ly: cy + (r + 22) * Math.sin(a),
    };
  });

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`}>
        {/* Background arc */}
        <path d={arcPath(-135, 135, r)} fill="none" stroke="var(--border)" strokeWidth={8} strokeLinecap="round" opacity={0.3} />

        {/* Red zone (0 - 0.85) */}
        <path d={arcPath(-135, -135 + 0.425 * 270, r)} fill="none" stroke="#EF4444" strokeWidth={8} strokeLinecap="round" opacity={0.2} />

        {/* Amber zone (0.85 - 1.0) */}
        <path d={arcPath(-135 + 0.425 * 270, -135 + 0.5 * 270, r)} fill="none" stroke="#F59E0B" strokeWidth={8} strokeLinecap="round" opacity={0.2} />

        {/* Green zone (1.0 - 2.0) */}
        <path d={arcPath(-135 + 0.5 * 270, 135, r)} fill="none" stroke="#10B981" strokeWidth={8} strokeLinecap="round" opacity={0.2} />

        {/* Active arc (filled to current value) */}
        <path d={arcPath(-135, angle, r)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
          style={{ transition: "all 1s ease-out" }} />

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--muted-foreground)" strokeWidth={1.5} opacity={0.4} />
            <text x={t.lx} y={t.ly} textAnchor="middle" dominantBaseline="middle" fill="var(--muted-foreground)" fontSize={8} opacity={0.5}>{t.label}</text>
          </g>
        ))}

        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={2.5} strokeLinecap="round"
          style={{ transition: "all 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)", transformOrigin: `${cx}px ${cy}px` }} />

        {/* Needle center dot */}
        <circle cx={cx} cy={cy} r={5} fill={color} />
        <circle cx={cx} cy={cy} r={2.5} fill="var(--card)" />

        {/* Value */}
        <text x={cx} y={cy + r * 0.35} textAnchor="middle" fill={color} fontSize={size * 0.16} fontWeight="bold"
          style={{ transition: "fill 0.5s" }}>
          {value.toFixed(2)}
        </text>
      </svg>
      <p className="text-xs font-bold mt-1" style={{ color }}>{label}</p>
      {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
