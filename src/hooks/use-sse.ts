"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app";

export function useAgentSSE() {
  const { setPendingApprovals, setUnreadNotifications } = useAppStore();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Connect to SSE
    const connect = () => {
      const es = new EventSource("/api/agents/events");

      es.addEventListener("approval_count", (e) => {
        const data = JSON.parse(e.data);
        setPendingApprovals(data.count);
      });

      es.addEventListener("notification_count", (e) => {
        const data = JSON.parse(e.data);
        setUnreadNotifications(data.count);
      });

      es.addEventListener("agent_activity", (e) => {
        // Could trigger a toast or update the activity feed
        const data = JSON.parse(e.data);
        console.log("[SSE] Agent activity:", data.agentName, data.summary);
      });

      es.addEventListener("credit_update", (e) => {
        const data = JSON.parse(e.data);
        console.log("[SSE] Credit balance:", data.balance);
      });

      es.onerror = () => {
        es.close();
        // Reconnect with backoff
        setTimeout(connect, 5000);
      };

      eventSourceRef.current = es;
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
    };
  }, [setPendingApprovals, setUnreadNotifications]);
}
