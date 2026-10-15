"use client";

import React from "react";
import { Bot, Database, Zap, Cpu, BarChart3, Layers } from "lucide-react";
import { AgentPersonaId } from "./types";

interface PersonaIconProps {
  id?: AgentPersonaId | string;
  icon?: AgentPersonaId | string;
  className?: string;
}

export default function PersonaIcon({
  id,
  icon,
  className = "w-4 h-4",
}: PersonaIconProps) {
  const iconId = id || icon || "orchestrator";
  switch (iconId) {
    case "orchestrator":
    case "sparrow":
      return <Bot className={className} />;
    case "data-engineer":
      return <Database className={className} />;
    case "feature-architect":
      return <Zap className={className} />;
    case "ml-scientist":
      return <Cpu className={className} />;
    case "validation-analyst":
      return <BarChart3 className={className} />;
    case "hierarchy-expert":
      return <Layers className={className} />;
    default:
      return <Bot className={className} />;
  }
}
