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
      onClick={onOpen}
      style={{ width: 248, minHeight: 200 }}
      className="group relative flex flex-col cursor-pointer rounded-2xl border border-border bg-surface shadow-soft hover:shadow-xl hover:border-primary/40 hover:-translate-y-1 transition-all duration-300"
    >
      <div className="flex flex-col flex-1 p-5">
        {/* Top Row: Folder Icon & Delete Button */}
        <div className="flex items-center justify-between mb-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/15 dark:bg-amber-400/20 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="#f59e0b"
              stroke="#d97706"
              strokeWidth="1.2"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>

          {/* Delete Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete Project"
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-border/60 bg-surface-muted/50 text-muted-foreground hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-500 transition-all duration-200 cursor-pointer"
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
            </svg>
          </button>
        </div>

        {/* Project Name */}
        <h3
          className="text-sm font-bold text-foreground tracking-tight mb-1 truncate group-hover:text-primary dark:group-hover:text-amber-400 transition-colors"
          title={project.name}
        >
          {project.name}
        </h3>

        {/* Use Case Description */}
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-4">
          {project.useCase
            ? project.useCase.replace(/[#*`_[\]]/g, "")
            : "No description provided."}
        </p>

        {/* Linked Data Sources Footer */}
        <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">
            Data Sources
          </span>
          <div className="flex -space-x-1.5 overflow-hidden">
            {project.dataSources.map((dsId) => {
              const ds = dataSources.find((s) => s.id === dsId);
              const type = ds ? ds.type : dsId;
              const name = ds ? ds.name : dsId.toUpperCase();
              return (
                <div
                  key={dsId}
                  title={name}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface border border-border shadow-xs p-0.5 shrink-0"
                >
                  {renderIcon(type)}
                </div>
              );
            })}
            {project.dataSources.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic font-normal">
                None
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
