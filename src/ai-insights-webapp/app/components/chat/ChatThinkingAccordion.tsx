"use client";

import React from "react";

interface ChatThinkingAccordionProps {
  thinking?: unknown[];
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export default function ChatThinkingAccordion({
  isStreaming = false,
}: ChatThinkingAccordionProps) {
  if (!isStreaming) return null;

  return (
    <div className="flex items-center gap-2 py-1 select-none">
      <span className="text-xs text-muted-foreground/60 animate-pulse font-normal tracking-wide">
        Sparrow is orchestrating the intelligence...
      </span>
    </div>
  );
}
