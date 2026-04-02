"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw, CheckCircle2, Users } from "lucide-react";

type RaciValue = "R" | "A" | "C" | "I" | "";

const people = ["Sarah C.", "James W.", "Priya P.", "Marcus B.", "Emma D."];
const activities = [
  "Define Requirements",
  "System Design",
  "Development",
  "Testing",
  "User Training",
  "Go-Live Deployment",
];

const initialMatrix: RaciValue[][] = [
  ["A", "C", "R", "I", "C"],
  ["C", "R", "A", "I", ""],
  ["I", "R", "C", "A", ""],
  ["", "C", "I", "A", "R"],
  ["R", "", "A", "C", "I"],
  ["A", "R", "C", "", "I"],
];

const cycle: RaciValue[] = ["", "R", "A", "C", "I"];

const cellColor = (v: RaciValue) => {
  if (v === "R") return "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 font-bold";
  if (v === "A") return "bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 font-bold";
  if (v === "C") return "bg-yellow-100 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 font-bold";
  if (v === "I") return "bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200 font-bold";
  return "bg-muted text-muted-foreground";
};

interface Validation {
  row: number;
  message: string;
}

function validate(matrix: RaciValue[][]): Validation[] {
  const warnings: Validation[] = [];
  matrix.forEach((row, i) => {
    const accountables = row.filter((v) => v === "A").length;
    const responsibles = row.filter((v) => v === "R").length;
    if (accountables === 0) warnings.push({ row: i, message: `"${activities[i]}" has no Accountable (A) assigned.` });
    if (accountables > 1) warnings.push({ row: i, message: `"${activities[i]}" has ${accountables} Accountable (A) -- should be exactly 1.` });
    if (responsibles === 0) warnings.push({ row: i, message: `"${activities[i]}" has no Responsible (R) assigned.` });
  });
  return warnings;
}

export default function RACIMatrixPage() {
  const [matrix, setMatrix] = useState(initialMatrix);

  const cycleCell = (row: number, col: number) => {
    setMatrix((prev) => {
      const next = prev.map((r) => [...r]);
      const current = next[row][col];
      const idx = cycle.indexOf(current);
      next[row][col] = cycle[(idx + 1) % cycle.length];
      return next;
    });
  };

  const warnings = validate(matrix);

  const stats = {
    R: matrix.flat().filter((v) => v === "R").length,
    A: matrix.flat().filter((v) => v === "A").length,
    C: matrix.flat().filter((v) => v === "C").length,
    I: matrix.flat().filter((v) => v === "I").length,
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">RACI Matrix</h1>
        <Button variant="outline" size="sm" onClick={() => setMatrix(initialMatrix)}>
          <RotateCcw className="h-4 w-4 mr-2" />Reset
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["R", "A", "C", "I"] as const).map((letter) => (
          <Card key={letter}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <span className={`w-8 h-8 rounded flex items-center justify-center text-sm ${cellColor(letter)}`}>{letter}</span>
                <div>
                  <p className="text-2xl font-bold">{stats[letter]}</p>
                  <p className="text-xs text-muted-foreground">
                    {letter === "R" ? "Responsible" : letter === "A" ? "Accountable" : letter === "C" ? "Consulted" : "Informed"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Instructions */}
      <Card>
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground">
            Click any cell to cycle through: <span className="font-medium">Empty</span> &rarr;{" "}
            <span className="font-medium text-blue-600">R</span> &rarr;{" "}
            <span className="font-medium text-red-600">A</span> &rarr;{" "}
            <span className="font-medium text-yellow-600">C</span> &rarr;{" "}
            <span className="font-medium text-green-600">I</span> &rarr; Empty
          </p>
        </CardContent>
      </Card>

      {/* Matrix */}
      <Card>
        <CardHeader><CardTitle className="text-sm">RACI Assignment Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4 text-left text-muted-foreground">Activity</th>
                  {people.map((p) => (
                    <th key={p} className="py-2 px-3 text-center text-muted-foreground min-w-[80px]">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activities.map((activity, row) => (
                  <tr key={activity} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{activity}</td>
                    {people.map((_, col) => (
                      <td key={col} className="py-2 px-3 text-center">
                        <button
                          onClick={() => cycleCell(row, col)}
                          className={`w-10 h-10 rounded-md text-sm transition-colors cursor-pointer ${cellColor(matrix[row][col])}`}
                        >
                          {matrix[row][col] || "-"}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Validation */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Validation</CardTitle>
            {warnings.length === 0 ? (
              <Badge variant="default">All clear</Badge>
            ) : (
              <Badge variant="destructive">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {warnings.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>All activities have exactly one Accountable and at least one Responsible assigned.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Legend</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs shrink-0 ${cellColor("R")}`}>R</span>
              <div><p className="font-medium">Responsible</p><p className="text-xs text-muted-foreground">Does the work to complete the task.</p></div>
            </div>
            <div className="flex items-start gap-2">
              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs shrink-0 ${cellColor("A")}`}>A</span>
              <div><p className="font-medium">Accountable</p><p className="text-xs text-muted-foreground">Ultimately answerable. One per activity.</p></div>
            </div>
            <div className="flex items-start gap-2">
              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs shrink-0 ${cellColor("C")}`}>C</span>
              <div><p className="font-medium">Consulted</p><p className="text-xs text-muted-foreground">Provides input before a decision.</p></div>
            </div>
            <div className="flex items-start gap-2">
              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs shrink-0 ${cellColor("I")}`}>I</span>
              <div><p className="font-medium">Informed</p><p className="text-xs text-muted-foreground">Kept in the loop after decisions.</p></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
