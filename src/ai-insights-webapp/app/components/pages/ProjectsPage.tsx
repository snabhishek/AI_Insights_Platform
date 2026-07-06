"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  PostgresqlIcon,
  MysqlIcon,
  SqlServerIcon,
  SnowflakeIcon,
  MongodbIcon,
  RestApiIcon,
  CsvIcon,
  TsvIcon,
  ExcelIcon,
} from "../datasource/Icons";
import { useApp, Project } from "../providers/AppContext";

const renderDataSourceIcon = (type: string) => {
  switch (type) {
    case "postgres":
      return <PostgresqlIcon size={16} />;
    case "mysql":
      return <MysqlIcon size={16} />;
    case "sqlserver":
      return <SqlServerIcon size={16} />;
    case "snowflake":
      return <SnowflakeIcon size={16} />;
    case "mongodb":
      return <MongodbIcon size={16} />;
    case "excel":
      return <ExcelIcon width={16} height={16} className="object-contain" />;
    case "csv":
      return <CsvIcon width={16} height={16} className="object-contain" />;
    case "tsv":
      return <TsvIcon width={16} height={16} className="object-contain" />;
    case "restapi":
      return <RestApiIcon size={16} />;
    default:
      return null;
  }
};

type RoleFilter = "all" | "OWNER" | "MEMBER";

export default function ProjectsPage() {
  const { projects, addProject, deleteProject, dataSources, activeWorkspaceId, showConfirm } = useApp();
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRole, setNewProjectRole] = useState<"OWNER" | "MEMBER">("OWNER");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  // Dropdown States
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleCreateProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    addProject(newProjectName.trim(), newProjectRole, selectedSources);
    
    // Reset Form
    setNewProjectName("");
    setNewProjectRole("OWNER");
    setSelectedSources([]);
    setShowCreateModal(false);
  };

  const toggleSourceSelection = (type: string) => {
    setSelectedSources((prev) =>
      prev.includes(type) ? prev.filter((s) => s !== type) : [...prev, type]
    );
  };

  // Filter projects by workspace, search term, and role
  const workspaceProjects = projects.filter((p) => p.workspaceId === activeWorkspaceId);
  
  let filtered = workspaceProjects.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (roleFilter !== "all") {
    filtered = filtered.filter((p) => p.role === roleFilter);
  }

  return (
    <div className="p-8 w-full flex flex-col min-h-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            My Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            Group your work, link database catalogs, and invite collaborators.
          </p>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-60">
            <input
              type="text"
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
            <span className="absolute left-3 top-[10px] text-muted-foreground pointer-events-none z-10">
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
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

      {/* Project Cards Grid */}
      <div className="flex flex-wrap gap-5">
        {/* New Project Card Trigger */}
        <div
          onClick={() => setShowCreateModal(true)}
          style={{ width: 248, minHeight: 200 }}
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface p-6 text-center cursor-pointer transition-all duration-300 hover:border-primary/40 hover:shadow-soft group"
        >
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center transition-colors group-hover:bg-primary/20 animate-pulse">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">New project</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Start something fresh
            </p>
          </div>
        </div>

        {/* Project Cards */}
        {filtered.map((project) => (
          <div
            key={project.id}
            style={{ width: 248 }}
            className="relative flex flex-col rounded-2xl border border-border bg-surface shadow-soft hover:shadow-soft-hover transition-all duration-300"
          >
            {/* Folder tab shape */}
            <div className="absolute -top-[8px] left-4 w-[40%] h-3 bg-primary rounded-t-md" />

            {/* Card Body */}
            <div className="flex flex-col flex-1 p-4 pt-5">
              {/* Top row: folder icon + role badge */}
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

                  {/* Delete Button */}
                  <button
                    onClick={() => {
                      showConfirm({
                        title: "Delete Project",
                        message: `Are you sure you want to delete the project "${project.name}"? This action cannot be undone.`,
                        confirmText: "Delete",
                        cancelText: "Cancel",
                        onConfirm: () => deleteProject(project.id),
                      });
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

              {/* Project name */}
              <h3 className="text-sm font-bold text-foreground tracking-tight mb-2.5">
                {project.name}
              </h3>

              {/* Data Sources Row */}
              <div className="flex items-center gap-2 mb-4 h-6">
                <div className="flex -space-x-1.5 overflow-hidden">
                  {project.dataSources.map((ds) => (
                    <div
                      key={ds}
                      title={ds.toUpperCase()}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-border overflow-hidden p-1 shadow-sm"
                    >
                      {renderDataSourceIcon(ds)}
                    </div>
                  ))}
                  {project.dataSources.length === 0 && (
                    <span className="text-[10px] text-muted-foreground italic font-medium">
                      No linked sources
                    </span>
                  )}
                </div>
              </div>

              {/* Separator */}
              <hr className="border-border mb-3" />

              {/* Bottom row: avatar + open link */}
              <div className="flex items-center justify-between mt-auto">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-[10px] font-bold">
                  {project.initials}
                </span>
                <a
                  href="#"
                  className="text-xs font-semibold text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
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
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* New Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-fade-in flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
              <h3 className="text-base font-bold text-foreground">
                Create New Project
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Finance Reporting, Q3 Audit"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Your Role
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewProjectRole("OWNER")}
                    className={`h-10 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                      newProjectRole === "OWNER"
                        ? "bg-primary text-white border-primary"
                        : "border-border text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    OWNER
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewProjectRole("MEMBER")}
                    className={`h-10 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                      newProjectRole === "MEMBER"
                        ? "bg-primary text-white border-primary"
                        : "border-border text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    MEMBER
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-2">
                  Link Connected Data Sources
                </label>
                {dataSources.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto space-y-2 border border-border/60 rounded-xl p-3 bg-surface-muted">
                    {dataSources.map((ds) => {
                      const isSelected = selectedSources.includes(ds.type);
                      return (
                        <div
                          key={ds.id}
                          onClick={() => toggleSourceSelection(ds.type)}
                          className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer select-none transition-all ${
                            isSelected
                              ? "bg-surface border-primary"
                              : "bg-surface border-border/40 hover:border-border"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="opacity-80 scale-90">{renderDataSourceIcon(ds.type)}</span>
                            <span className="text-xs font-semibold text-foreground">{ds.name}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic p-3 text-center border border-dashed border-border rounded-lg">
                    No active data sources available. Connect a source first.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-border pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="h-9 px-4 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-surface-muted transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newProjectName.trim()}
                  className="h-9 px-4 bg-primary text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:scale-100"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
