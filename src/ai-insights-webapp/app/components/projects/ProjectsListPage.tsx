"use client";

import React, { useState } from "react";
import { Project, DataSource } from "../providers/AppContext";
import ProjectCard from "./ProjectCard";

type RoleFilter = "all" | "OWNER" | "MEMBER";

interface ProjectsListPageProps {
  projects: Project[];
  dataSources: DataSource[];
  activeWorkspaceId: string;
  onOpenProject: (id: string) => void;
  onDeleteProject: (project: Project) => void;
  onCreateProject: () => void;
  renderIcon: (type: string) => React.ReactNode;
}

export default function ProjectsListPage({
  projects,
  dataSources,
  activeWorkspaceId,
  onOpenProject,
  onDeleteProject,
  onCreateProject,
  renderIcon,
}: ProjectsListPageProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const workspaceProjects = projects.filter((p) => p.workspaceId === activeWorkspaceId);
  const filtered = workspaceProjects
    .filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((p) => roleFilter === "all" || p.role === roleFilter);

  return (
    <div className="p-8 w-full flex flex-col min-h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">My Projects</h1>
          <p className="text-sm text-muted-foreground">
            Group your work, link database catalogs, and invite collaborators.
          </p>
        </div>

        {/* Search + Role filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-60">
            <input
              type="text"
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
            <span className="absolute left-3 top-[10px] text-muted-foreground pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
          </div>

          <div className="flex gap-1 bg-surface-muted p-0.5 rounded-lg border border-border text-xs font-semibold">
            {(["all", "OWNER", "MEMBER"] as const).map((role) => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={`px-3 py-1.5 rounded-md cursor-pointer transition-all ${
                  roleFilter === role
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {role === "all" ? "All Roles" : role}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="flex flex-wrap gap-5">
        {/* Create New card */}
        <div
          onClick={onCreateProject}
          style={{ width: 248, minHeight: 220 }}
          className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-surface to-surface p-6 text-center cursor-pointer transition-all duration-300 hover:border-primary hover:shadow-soft-hover hover:-translate-y-1.5 group"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-primary to-indigo-600 flex items-center justify-center text-white shadow-md transform transition-transform duration-500 group-hover:rotate-90 group-hover:scale-110">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div className="flex flex-col items-center">
            <p className="text-sm font-bold text-foreground tracking-tight group-hover:text-primary transition-colors">
              Create New Project
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-normal max-w-[190px]">
              Configure use case detail and link connected data catalogs.
            </p>
          </div>
        </div>

        {/* Project cards */}
        {filtered.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            dataSources={dataSources}
            onOpen={() => onOpenProject(project.id)}
            onDelete={() => onDeleteProject(project)}
            renderIcon={renderIcon}
          />
        ))}
      </div>
    </div>
  );
}
