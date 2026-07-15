"use client";

import React from "react";
import { Project, DataSource } from "../providers/AppContext";

interface ProjectCardProps {
  project: Project;
  dataSources: DataSource[];
  onOpen: () => void;
  onDelete: () => void;
  renderIcon: (type: string) => React.ReactNode;
}

export default function ProjectCard({
  project,
  dataSources,
  onOpen,
  onDelete,
  renderIcon,
}: ProjectCardProps) {
  return (
    <div
      style={{ width: 248 }}
      className="relative flex flex-col rounded-2xl border border-border bg-surface shadow-soft hover-lift duration-300"
    >
      {/* Folder tab */}
      <div className="absolute -top-[8px] left-4 w-[40%] h-3 bg-primary rounded-t-md" />

      <div className="flex flex-col flex-1 p-4 pt-5">
        {/* Top row */}
        <div className="flex items-start justify-between mb-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-primary"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="flex items-center gap-1">
            <span
              className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                project.role === "OWNER"
                  ? "text-primary border-primary/30 bg-primary/5"
                  : "text-muted-foreground border-border bg-surface-muted"
              }`}
            >
              {project.role}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete Project"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-red-500/5 hover:border-red-500/30 hover:text-red-500 transition-all duration-200 cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </div>
        </div>

        {/* Name */}
        <h3 className="text-sm font-bold text-foreground tracking-tight mb-1 truncate" title={project.name}>
          {project.name}
        </h3>

        {/* Use case preview */}
        {project.useCase ? (
          <p className="text-[11px] text-muted-foreground truncate mb-2 mt-0.5">
            {project.useCase.replace(/[#*`_[\]]/g, "").slice(0, 50)}
          </p>
        ) : (
          <div className="h-4 mb-2" />
        )}

        {/* Data source icons */}
        <div className="flex items-center gap-2 mb-4 h-6">
          <div className="flex -space-x-1.5 overflow-hidden">
            {project.dataSources.map((dsId) => {
              const ds = dataSources.find((s) => s.id === dsId);
              const type = ds ? ds.type : dsId;
              const name = ds ? ds.name : dsId.toUpperCase();
              return (
                <div
                  key={dsId}
                  title={name}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-border overflow-hidden p-1 shadow-sm shrink-0"
                >
                  {renderIcon(type)}
                </div>
              );
            })}
            {project.dataSources.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic font-medium">
                No linked sources
              </span>
            )}
          </div>
        </div>

        <hr className="border-border mb-3" />

        {/* Bottom row */}
        <div className="flex items-center justify-between mt-auto">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-[10px] font-bold">
            {project.initials}
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="text-xs font-semibold text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors cursor-pointer"
          >
            Open
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
