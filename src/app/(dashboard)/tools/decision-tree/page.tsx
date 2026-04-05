"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranch, Calculator, RotateCcw } from "lucide-react";

interface DecisionNode {
  id: string;
  label: string;
  type: "decision" | "chance" | "outcome";
  probability: number;
  value: number;
  children: DecisionNode[];
}

const initialTree: DecisionNode[] = [
  {
    id: "d1", label: "Build In-House", type: "decision", probability: 1, value: 0,
    children: [
      {
        id: "c1a", label: "On-time delivery", type: "chance", probability: 0.6, value: 0,
        children: [
          { id: "o1", label: "Full revenue capture", type: "outcome", probability: 1, value: 500000, children: [] },
        ],
      },
      {
        id: "c1b", label: "Delayed delivery", type: "chance", probability: 0.4, value: 0,
        children: [
          { id: "o2", label: "Partial revenue + penalties", type: "outcome", probability: 1, value: 200000, children: [] },
        ],
      },
    ],
  },
  {
    id: "d2", label: "Outsource Development", type: "decision", probability: 1, value: 0,
    children: [
      {
        id: "c2a", label: "Vendor delivers quality", type: "chance", probability: 0.7, value: 0,
        children: [
          { id: "o3", label: "Revenue with vendor cost", type: "outcome", probability: 1, value: 350000, children: [] },
        ],
      },
      {
        id: "c2b", label: "Vendor underperforms", type: "chance", probability: 0.3, value: 0,
        children: [
          { id: "o4", label: "Rework + delayed revenue", type: "outcome", probability: 1, value: 100000, children: [] },
        ],
      },
    ],
  },
];

function calcEMV(node: DecisionNode): number {
  if (node.type === "outcome") return node.value * node.probability;
  if (node.children.length === 0) return 0;
  const childSum = node.children.reduce((sum, c) => sum + calcEMV(c) * c.probability, 0);
  return childSum;
}

const typeColor = (t: string) => {
  if (t === "decision") return "bg-blue-100 dark:bg-blue-950 border-blue-300 dark:border-blue-800";
  if (t === "chance") return "bg-yellow-100 dark:bg-yellow-950 border-yellow-300 dark:border-yellow-800";
  return "bg-green-100 dark:bg-green-950 border-green-300 dark:border-green-800";
};

export default function DecisionTreePage() {
  const [tree, setTree] = useState(initialTree);

  const updateProbability = (path: string[], value: number) => {
    const updated = JSON.parse(JSON.stringify(tree)) as DecisionNode[];
    let nodes: DecisionNode[] = updated;
    for (let i = 0; i < path.length - 1; i++) {
      const node = nodes.find((n) => n.id === path[i]);
      if (!node) return;
      nodes = node.children;
    }
    const target = nodes.find((n) => n.id === path[path.length - 1]);
    if (target) target.probability = value;
    setTree(updated);
  };

  const updateValue = (path: string[], value: number) => {
    const updated = JSON.parse(JSON.stringify(tree)) as DecisionNode[];
    let nodes: DecisionNode[] = updated;
    for (let i = 0; i < path.length - 1; i++) {
      const node = nodes.find((n) => n.id === path[i]);
      if (!node) return;
      nodes = node.children;
    }
    const target = nodes.find((n) => n.id === path[path.length - 1]);
    if (target) target.value = value;
    setTree(updated);
  };

  const bestOption = tree.reduce((best, node) => {
    const emv = calcEMV(node);
    return emv > best.emv ? { label: node.label, emv } : best;
  }, { label: "", emv: -Infinity });

  const renderNode = (node: DecisionNode, depth: number, path: string[]) => {
    const currentPath = [...path, node.id];
    const emv = calcEMV(node);
    return (
      <div key={node.id} className={`${depth > 0 ? "ml-6 border-l-2 border-muted pl-4" : ""}`}>
        <div className={`rounded-lg border p-3 mb-2 ${typeColor(node.type)}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge variant={node.type === "decision" ? "default" : node.type === "chance" ? "secondary" : "outline"} className="text-xs">
                {node.type === "decision" ? "Decision" : node.type === "chance" ? "Chance" : "Outcome"}
              </Badge>
              <span className="text-sm font-medium">{node.label}</span>
            </div>
            <span className="text-sm font-bold tabular-nums">EMV: £{emv.toLocaleString()}</span>
          </div>
          {node.type === "chance" && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-muted-foreground">P:</label>
              <input
                type="number"
                min={0} max={1} step={0.05}
                value={node.probability}
                onChange={(e) => updateProbability(currentPath, parseFloat(e.target.value) || 0)}
                className="w-20 text-sm border rounded px-2 py-1 bg-background tabular-nums"
              />
            </div>
          )}
          {node.type === "outcome" && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Value (£):</label>
              <input
                type="number"
                step={10000}
                value={node.value}
                onChange={(e) => updateValue(currentPath, parseFloat(e.target.value) || 0)}
                className="w-32 text-sm border rounded px-2 py-1 bg-background tabular-nums"
              />
            </div>
          )}
        </div>
        {node.children.map((child) => renderNode(child, depth + 1, currentPath))}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-[1400px] pb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Decision Tree</h1>
        <Button variant="outline" size="sm" onClick={() => setTree(initialTree)}>
          <RotateCcw className="h-4 w-4 mr-2" />Reset
        </Button>
      </div>

      {/* EMV Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tree.map((node) => (
          <Card key={node.id}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <GitBranch className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{node.label}</p>
                  <p className="text-2xl font-bold tabular-nums">£{calcEMV(node).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Expected Monetary Value</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        <Card className="border-primary">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Calculator className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Recommended</p>
                <p className="text-2xl font-bold text-primary">{bestOption.label}</p>
                <p className="text-xs text-muted-foreground">Highest EMV: £{bestOption.emv.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Decision Tree */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Interactive Decision Nodes</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {tree.map((node) => renderNode(node, 0, []))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
