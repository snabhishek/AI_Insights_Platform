"use client";

import React from "react";
import { Project } from "../providers/AppContext";

interface ProjectInfoPanelProps {
  project: Project;
}

export default function ProjectInfoPanel({ project }: ProjectInfoPanelProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-soft">
      <h2 className="text-base font-bold text-foreground border-b border-border pb-3 mb-4">
        Project Description & Details
      </h2>

      {project.projectName && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Project Name
          </p>
          <p className="text-sm font-medium text-foreground">
            {project.projectName}
          </p>
        </div>
      )}

      <div className="text-xs leading-relaxed text-muted-foreground">
        <p className="whitespace-pre-wrap">
          {project.useCase
            ? project.useCase.replace(/[#*`_[\]]/g, "")
            : "Analyze sales trends, top-performing regions, and product effectiveness across all channels."}
        </p>
      </div>
    </div>
  );
}
