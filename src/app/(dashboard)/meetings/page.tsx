"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Video, Plus, Mic } from "lucide-react";

export default function MeetingsPage() {
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Meetings</h1><p className="text-sm text-muted-foreground mt-1">Meeting intelligence powered by AI</p></div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Schedule Meeting</Button>
      </div>
      <Card>
        <CardContent className="pt-5 text-center py-16">
          <Video className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">Meeting Intelligence</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            Your AI agents can join Google Meet, Zoom, and Teams calls via Recall.ai. They transcribe conversations, extract action items, log decisions, and update project plans — all automatically.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button size="sm"><Mic className="w-4 h-4 mr-1" /> Connect Recall.ai</Button>
            <Button variant="outline" size="sm">Upload Transcript</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
