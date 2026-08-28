"use client";

import { useEffect } from "react";
import { processOutbox } from "@/lib/data/outbox";

export default function OutboxSync() {
  useEffect(() => {
    // 1. Listen for network reconnection
    const handleOnline = () => {
      console.log("[OutboxSync] Network online, processing outbox...");
      processOutbox();
    };

    window.addEventListener("online", handleOnline);

    // 2. Poll every 60 seconds just in case
    const interval = setInterval(() => {
      if (navigator.onLine) {
        processOutbox();
      }
    }, 60000);

    // Process on mount if online
    if (navigator.onLine) {
      processOutbox();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      clearInterval(interval);
    };
  }, []);

  // Render nothing, it's a silent background component
  return null;
}
