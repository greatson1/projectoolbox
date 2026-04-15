"use client";

/**
 * KB Graph View — visual map of knowledge items and their connections.
 * Shows items as nodes positioned by type, with lines connecting
 * items that share tags or reference each other.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";

const TYPE_COLORS: Record<string, string> = {
  TEXT: "#6366F1", FILE: "#22D3EE", URL: "#10B981",
  EMAIL: "#F59E0B", TRANSCRIPT: "#8B5CF6", CHAT: "#EC4899",
  DECISION: "#EF4444", IMAGE: "#14B8A6", ASSUMPTION: "#F97316",
};

const TRUST_SIZES: Record<string, number> = {
  HIGH_TRUST: 44, STANDARD: 36, REFERENCE_ONLY: 28,
};

interface KBGraphViewProps {
  items: any[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function KBGraphView({ items, onSelect, selectedId }: KBGraphViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Build connections: items that share tags or reference each other by title
  const { nodes, edges } = useMemo(() => {
    const nodeList = items.map((item, i) => {
      // Position nodes in a circular/grid layout
      const cols = Math.ceil(Math.sqrt(items.length));
      const row = Math.floor(i / cols);
      const col = i % cols;
      const padding = 80;
      const spacingX = 160;
      const spacingY = 120;
      // Add some jitter to avoid perfect grid
      const jitterX = (Math.sin(i * 2.1) * 20);
      const jitterY = (Math.cos(i * 1.7) * 15);

      return {
        id: item.id,
        title: item.title?.replace(/^\[.*?\]\s*/, "").slice(0, 30) || "Untitled",
        type: item.type || "TEXT",
        trustLevel: item.trustLevel || "STANDARD",
        tags: item.tags || [],
        x: padding + col * spacingX + jitterX,
        y: padding + row * spacingY + jitterY,
      };
    });

    // Build edges based on shared tags
    const edgeList: Array<{ from: string; to: string; strength: number }> = [];
    const seen = new Set<string>();

    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const a = nodeList[i];
        const b = nodeList[j];
        const sharedTags = a.tags.filter((t: string) =>
          b.tags.includes(t) && t !== "auto-extracted" && t !== "approved-artefact"
        );
        if (sharedTags.length > 0) {
          const key = `${a.id}-${b.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            edgeList.push({ from: a.id, to: b.id, strength: sharedTags.length });
          }
        }
      }
    }

    return { nodes: nodeList, edges: edgeList };
  }, [items]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Calculate SVG dimensions
  const maxX = Math.max(...nodes.map(n => n.x), 400) + 100;
  const maxY = Math.max(...nodes.map(n => n.y), 300) + 100;

  if (items.length === 0) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No items to display</div>;
  }

  return (
    <div className="flex-1 overflow-auto bg-muted/10 rounded-xl border border-border">
      <svg width={maxX} height={maxY} className="w-full h-full" style={{ minWidth: maxX, minHeight: maxY }}>
        {/* Edges */}
        {edges.map((edge, i) => {
          const from = nodeMap.get(edge.from);
          const to = nodeMap.get(edge.to);
          if (!from || !to) return null;
          const isHighlighted = hoveredId === edge.from || hoveredId === edge.to || selectedId === edge.from || selectedId === edge.to;
          return (
            <line key={i}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={isHighlighted ? "#6366F1" : "var(--border)"}
              strokeWidth={isHighlighted ? 2 : 1}
              strokeOpacity={isHighlighted ? 0.8 : 0.3}
              strokeDasharray={edge.strength > 1 ? "none" : "4 4"}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const size = TRUST_SIZES[node.trustLevel] || 36;
          const color = TYPE_COLORS[node.type] || "#6366F1";
          const isSelected = selectedId === node.id;
          const isHovered = hoveredId === node.id;
          const isConnected = edges.some(e =>
            (e.from === hoveredId && e.to === node.id) || (e.to === hoveredId && e.from === node.id)
          );

          return (
            <g key={node.id}
              onClick={() => onSelect(node.id)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="cursor-pointer"
            >
              {/* Node circle */}
              <circle
                cx={node.x} cy={node.y} r={size / 2}
                fill={color}
                fillOpacity={isSelected ? 0.9 : isHovered || isConnected ? 0.7 : 0.4}
                stroke={isSelected ? "#fff" : isHovered ? color : "none"}
                strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 0}
              />
              {/* Type initial */}
              <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
                fill="white" fontSize={10} fontWeight={600}>
                {node.type[0]}
              </text>
              {/* Title label */}
              <text x={node.x} y={node.y + size / 2 + 12} textAnchor="middle"
                fill="var(--foreground)" fontSize={9} fontWeight={isSelected ? 600 : 400}
                opacity={isSelected || isHovered || isConnected ? 1 : 0.6}>
                {node.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
