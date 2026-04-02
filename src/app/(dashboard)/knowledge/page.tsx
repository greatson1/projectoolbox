"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Plus, Search } from "lucide-react";

export default function KnowledgeBasePage() {
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Knowledge Base</h1><p className="text-sm text-muted-foreground mt-1">Obsidian-inspired bidirectional linking</p></div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Entry</Button>
      </div>
      <Card>
        <CardContent className="pt-5 text-center py-16">
          <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">Knowledge Base</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            Your AI agents build the knowledge base as they work — linking risks to decisions, artefacts to phases, and meeting notes to action items. Every entity is connected with bidirectional links.
          </p>
          <p className="text-xs text-muted-foreground">Knowledge entries will appear here as your agents process documents, meetings, and decisions.</p>
        </CardContent>
      </Card>
    </div>
  );
}
