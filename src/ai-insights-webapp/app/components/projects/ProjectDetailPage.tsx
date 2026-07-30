"use client";

import React, { useState } from "react";
import { Project, DataSource, UserProfile } from "../providers/AppContext";
import { PipelineStatuses, RunStatus, Workflow } from "./types";
import ProjectDataSources from "./ProjectDataSources";
import WorkflowPipeline from "./WorkflowPipeline";
import CardModal from "../shared/ui/CardModal";
import { PIPELINE_STEPS } from "./constants";

type AlertType = "error" | "success" | "info";

// ─── Mock fallback data sources ───────────────────────────────────────────────

function buildMockSources(workspaceId: string): DataSource[] {
  return [
    {
      id: "mock-pg",
      name: "PostgreSQL Production",
      subtext: "Database",
      type: "postgres",
      status: "Connected",
      health: "Healthy",
      lastSyncTime: "10:14 AM",
      lastSyncDate: "July 12, 2026",
      workspaceId,
      assets: { tables: 42, views: 8, pipelines: 3 },
      connectionConfig: { host: "192.168.1.10", port: "5432", database: "ERP Database" },
    },
    {
      id: "mock-sf",
      name: "Snowflake Warehouse",
      subtext: "Data Warehouse",
      type: "snowflake",
      status: "Connected",
      health: "Healthy",
      lastSyncTime: "09:30 AM",
      lastSyncDate: "July 12, 2026",
      workspaceId,
      assets: { tables: 110, views: 24, pipelines: 5 },
      connectionConfig: { host: "us-west-2", database: "Analytics DB" },
    },
    {
      id: "mock-csv",
      name: "Sales Data CSV",
      subtext: "File Upload",
      type: "csv",
      status: "Connected",
      health: "Healthy",
      lastSyncTime: "11:05 AM",
      lastSyncDate: "July 12, 2026",
      workspaceId,
      assets: { tables: 1, views: 0, pipelines: 0 },
      connectionConfig: { fileName: "sales_data_june.csv" },
    },
  ];
}

// ─── Step Output Components ───────────────────────────────────────────────────

interface IngestionStepOutputProps {
  inspectOutput: any;
}

function IngestionStepOutput({ inspectOutput }: IngestionStepOutputProps) {
  const [expandedTableKey, setExpandedTableKey] = useState<string | null>(null);
  const rawSources = inspectOutput?.sources;
  const sources = Array.isArray(rawSources)
    ? rawSources
    : inspectOutput?.tables
      ? [{ connectorName: "Ingested Database", tables: inspectOutput.tables }]
      : [];

  if (sources.length === 0) {
    return <p className="text-xs text-muted-foreground">No tables list found in output payload.</p>;
  }

  return (
    <div className="space-y-4 select-none">
      {sources.map((src: any, srcIdx: number) => {
        const srcName = src.connectorName || src.connectorId || `Data Connector #${srcIdx + 1}`;
        const tables = Array.isArray(src.tables) ? src.tables : [];

        return (
          <div key={srcIdx} className="border border-border rounded-xl overflow-hidden bg-surface-muted/20">
            <div className="bg-surface-muted px-4 py-2.5 flex items-center justify-between border-b border-border">
              <span className="text-xs font-bold text-foreground">{srcName}</span>
              <span className="text-[10px] font-semibold text-muted-foreground bg-surface border border-border px-2 py-0.5 rounded">
                {tables.length} table{tables.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="divide-y divide-border">
              {tables.map((table: any, tIdx: number) => {
                const tableName = table.name || table.tableName || `table_${tIdx}`;
                const columns = Array.isArray(table.columns) ? table.columns : [];
                const uniqueKey = `${srcIdx}-${tableName}`;
                const isExpanded = expandedTableKey === uniqueKey;

                return (
                  <div key={uniqueKey} className="bg-surface/50">
                    <button
                      onClick={() => setExpandedTableKey(isExpanded ? null : uniqueKey)}
                      className="w-full text-left px-4 py-2 flex items-center justify-between hover:bg-surface-muted/40 transition-colors focus:outline-none cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{tableName}</span>
                        {table.tableType && (
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-surface px-1.5 py-0.5 rounded border border-border">
                            {table.tableType}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground transform transition-transform duration-200">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 bg-surface select-text">
                        <table className="w-full text-[11px] text-left border-collapse mt-2">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground text-[10px] uppercase font-bold bg-surface-muted/30">
                              <th className="py-1.5 px-2">Column Name</th>
                              <th className="py-1.5 px-2">Data Type</th>
                              <th className="py-1.5 px-2 text-center">Nullable</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {columns.map((col: any, cIdx: number) => (
                              <tr key={cIdx} className="hover:bg-surface-muted/30">
                                <td className="py-1.5 px-2 font-mono font-semibold text-foreground">{col.technicalName}</td>
                                <td className="py-1.5 px-2 text-muted-foreground font-mono">{col.dataType || "unknown"}</td>
                                <td className="py-1.5 px-2 text-center text-muted-foreground">
                                  {col.nullable === false || col.nullable === "NO" ? (
                                    <span className="text-rose-500 font-bold">No</span>
                                  ) : (
                                    <span>Yes</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ProfilingStepOutputProps {
  profileData: any;
  preprocess: any;
}

function ProfilingStepOutput({ profileData, preprocess }: ProfilingStepOutputProps) {
  const profileTables = Array.isArray(profileData?.profile?.tables)
    ? profileData.profile.tables
    : Array.isArray(profileData?.sources)
      ? profileData.sources.flatMap((s: any) => s.tables || [])
      : [];

  const preSteps = Array.isArray(preprocess?.steps) ? preprocess.steps : [];
  const preNotes = preprocess?.notes || "";

  return (
    <div className="space-y-6 select-none">
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Profiling Results</span>
        {profileTables.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">No profiling dataset table profiles available.</p>
        ) : (
          <div className="mt-2 space-y-4">
            {profileTables.map((table: any, tIdx: number) => {
              const cols = Array.isArray(table.columns) ? table.columns : [];

              return (
                <div key={tIdx} className="border border-border rounded-xl bg-surface-muted/10 overflow-hidden">
                  <div className="bg-surface-muted px-4 py-2 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">{table.name || "Table Profile"}</span>
                    <span className="text-[10px] font-semibold text-muted-foreground bg-surface border border-border px-2 py-0.5 rounded">
                      {table.sampleSize || 0} sample rows analyzed
                    </span>
                  </div>

                  <div className="p-3 select-text">
                    <table className="w-full text-[11px] text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-[10px] uppercase font-bold bg-surface-muted/30">
                          <th className="py-1 px-2">Column Name</th>
                          <th className="py-1 px-2 text-right">Null Count</th>
                          <th className="py-1 px-2 text-right">Non-Null Count</th>
                          <th className="py-1 px-2 text-right">Unique Values</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {cols.map((col: any, cIdx: number) => (
                          <tr key={cIdx} className="hover:bg-surface-muted/30">
                            <td className="py-1.5 px-2 font-mono font-semibold text-foreground">{col.name}</td>
                            <td className={`py-1.5 px-2 text-right font-mono ${col.nullCount > 0 ? "text-amber-500 font-bold" : "text-muted-foreground"}`}>{col.nullCount}</td>
                            <td className="py-1.5 px-2 text-right text-muted-foreground font-mono">{col.nonNullCount}</td>
                            <td className="py-1.5 px-2 text-right text-muted-foreground font-mono">{col.uniqueCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4 select-text">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preprocessing Operations</span>
        {preSteps.length === 0 && !preNotes ? (
          <p className="text-xs text-muted-foreground mt-2">No preprocessing rules were auto-generated.</p>
        ) : (
          <div className="mt-2 space-y-3 select-none">
            <div className="flex flex-wrap gap-2">
              {preSteps.map((step: string) => (
                <span key={step} className="px-2.5 py-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-xl capitalize">
                  {step.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            {preNotes && (
              <div className="p-3 bg-surface-muted/60 border border-border rounded-xl text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap select-text">
                {preNotes}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface SchemaResolverStepOutputProps {
  resolveSchema: any;
}

function SchemaResolverStepOutput({ resolveSchema }: SchemaResolverStepOutputProps) {
  const mappingsCount = typeof resolveSchema?.mappings === "number" ? resolveSchema.mappings : 0;
  const resolvedTables = Array.isArray(resolveSchema?.resolvedTables) ? resolveSchema.resolvedTables : [];
  const unmapped = Array.isArray(resolveSchema?.unmappedDatasetFields) ? resolveSchema.unmappedDatasetFields : [];

  return (
    <div className="space-y-4 select-none">
      <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-xl text-xs text-emerald-800 dark:text-emerald-300">
        <strong>Schema Resolution finalized.</strong> Target mapping models are ready.
      </div>

      <div className="select-text space-y-4">
        <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-surface">
          {resolvedTables.length > 0 && (
            <div className="p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">Resolved Entity Tables</span>
              <div className="flex flex-wrap gap-1.5 mt-1 select-none">
                {resolvedTables.map((tbl: string) => (
                  <span key={tbl} className="px-2 py-0.5 bg-surface-muted border border-border text-xs rounded-md font-semibold text-foreground">
                    {tbl}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">Mapping Statistics</span>
            <p className="text-xs text-foreground mt-1">
              Successfully aligned <span className="font-bold text-indigo-500 font-mono">{mappingsCount} fields</span> to downstream model constraints.
            </p>
          </div>

          {unmapped.length > 0 && (
            <div className="p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-500 dark:text-rose-400 block mb-1">Unmapped Custom Fields</span>
              <div className="flex flex-wrap gap-1.5 mt-1 select-none">
                {unmapped.map((f: string) => (
                  <span key={f} className="px-2 py-0.5 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/60 text-xs rounded-md text-rose-700 dark:text-rose-400 font-semibold font-mono">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="text-[11px] text-muted-foreground italic text-center mt-3 select-none">
          Note: Advanced resolver mappings schema view is currently TBD in downstream dashboard configurations.
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectDetailPageProps {
  project: Project;
  allDataSources: DataSource[];
  userProfile: UserProfile;
  pipelineStatuses: PipelineStatuses;
  completionPercentage: number;
  runStatus: RunStatus;
  lastRunTime: string;
  onRunWorkflow: () => void;
  onReRunWorkflow?: (newUseCase?: string) => void;
  onSaveUseCase?: (newUseCase: string) => Promise<void> | void;
  onStopWorkflow?: () => void;
  onGoBack: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onViewHistory: () => void;
  onManageSources: () => void;
  onAddTag: () => void;
  activeStage: string | null;
  stageOutputs: Record<string, unknown>;
  requiresApproval: boolean;
  workflowMessage: string;
  onSelectStage: (stepId: string) => void;
  onApprove: () => void;
  onRetry: (stepId: string) => void;
  showAlert: (opts: { title: string; message: string; type: AlertType; logs?: string }) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProjectDetailPage({
  project,
  allDataSources,
  userProfile,
  pipelineStatuses,
  completionPercentage,
  runStatus,
  lastRunTime,
  onRunWorkflow,
  onReRunWorkflow,
  onSaveUseCase,
  onStopWorkflow,
  onGoBack,
  onDelete,
  onEdit,
  onViewHistory,
  onManageSources,
  onAddTag,
  activeStage,
  stageOutputs,
  requiresApproval,
  workflowMessage,
  onSelectStage,
  onApprove,
  onRetry,
  showAlert,
}: ProjectDetailPageProps) {
  const [isEditingUseCase, setIsEditingUseCase] = React.useState(false);
  const [editedUseCaseText, setEditedUseCaseText] = React.useState(project.useCase || "");
  const [isExecutionModalOpen, setIsExecutionModalOpen] = useState<boolean>(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);

  React.useEffect(() => {
    setEditedUseCaseText(project.useCase || "");
  }, [project.useCase]);

  const handleSelectStage = (stepId: string) => {
    onSelectStage(stepId);
    const match = PIPELINE_STEPS.find((item) => item.id === stepId);
    if (match) {
      setSelectedWorkflow(match);
      setIsExecutionModalOpen(true);
    }
  };

  const projectSources = allDataSources.filter((ds) =>
    project.dataSources.includes(ds.id)
  );
  const displaySources =
    projectSources.length > 0
      ? projectSources
      : buildMockSources(project.workspaceId);
  projectSources.length > 0
    ? projectSources
    : buildMockSources(project.workspaceId);

  return (
    <>
      <div className="p-8 w-full flex flex-col min-h-full bg-background animate-fade-in select-none">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground mb-2 select-none">
          <button
            onClick={onGoBack}
            className="hover:text-primary cursor-pointer hover:underline transition-colors"
          >
            Projects
          </button>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-foreground">{project.name}</span>
        </nav>

        {/* ── Project Header ── */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
                {project.name}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                Active
              </span>
            </div>
          </div>

          {/* Icon action buttons */}
          <div className="flex items-center gap-2.5 shrink-0 select-none">
            <button
              onClick={onEdit}
              title="Edit Project"
              className="w-10 h-10 rounded-full border border-border bg-surface text-muted-foreground hover:text-primary hover:bg-surface-muted flex items-center justify-center cursor-pointer transition-colors shadow-sm"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>

            <button
              onClick={onDelete}
              title="Delete Project"
              className="w-10 h-10 rounded-full border border-border bg-surface text-muted-foreground hover:text-red-500 hover:border-red-200 hover:bg-red-50/40 flex items-center justify-center cursor-pointer transition-colors shadow-sm"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>

            <button
              onClick={() =>
                showAlert({
                  title: "Project Actions",
                  message: "Additional project actions are being worked separately in the backend.",
                  type: "info",
                })
              }
              title="More Actions"
              className="w-10 h-10 rounded-full border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-muted flex items-center justify-center cursor-pointer transition-colors shadow-sm"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Modernized Top Metadata Grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-8 select-none">
          {/* Owner */}
          <div className="flex flex-col gap-1.5 p-3.5 bg-surface border border-border rounded-xl shadow-soft">
            <span className="font-bold text-muted-foreground uppercase tracking-wider text-[9px]">Owner</span>
            <span className="font-semibold text-foreground text-xs truncate">{userProfile.name}</span>
          </div>

          {/* Environment */}
          <div className="flex flex-col gap-1.5 p-3.5 bg-surface border border-border rounded-xl shadow-soft">
            <span className="font-bold text-muted-foreground uppercase tracking-wider text-[9px]">Environment</span>
            <span className="font-semibold text-foreground text-xs">Production</span>
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-1.5 p-3.5 bg-surface border border-border rounded-xl shadow-soft">
            <span className="font-bold text-muted-foreground uppercase tracking-wider text-[9px]">Schedule</span>
            <span className="font-semibold text-foreground text-xs truncate">Daily at 02:00 AM (UTC)</span>
          </div>

          {/* Notifications */}
          <div className="flex flex-col gap-1.5 p-3.5 bg-surface border border-border rounded-xl shadow-soft">
            <span className="font-bold text-muted-foreground uppercase tracking-wider text-[9px]">Notifications</span>
            <span className="font-semibold text-foreground text-xs">On</span>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5 p-3.5 bg-surface border border-border rounded-xl shadow-soft">
            <span className="font-bold text-muted-foreground uppercase tracking-wider text-[9px]">Tags</span>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              {["Sales", "Analytics", "Executive"].map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-md bg-surface-muted border border-border text-[9px] font-bold text-muted-foreground">
                  {tag}
                </span>
              ))}
              <button
                onClick={onAddTag}
                className="w-4 h-4 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer text-[10px] font-bold select-none"
                title="Add Tag"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* ── Main Layout Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* Left Column: Data Sources & Project Description */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-3 flex flex-col gap-6">
            <ProjectDataSources
              displaySources={displaySources}
              onManage={onManageSources}
              onViewDetails={(ds) =>
                showAlert({
                  title: ds.name,
                  message: `Connector properties for ${ds.name}. Details: ${JSON.stringify(ds.connectionConfig ?? {})}`,
                  type: "info",
                })
              }
            />

            {/* Project Use Case Description Panel */}
            <div className="flex flex-col bg-surface border border-border rounded-2xl p-5 shadow-soft select-none">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
                <div>
                  <h2 className="text-sm font-bold text-foreground">
                    Project Use Case
                  </h2>
                  <p className="text-[9px] text-muted-foreground mt-0.5">
                    Detailed description of project objectives.
                  </p>
                </div>
                {!isEditingUseCase && (
                  <button
                    onClick={() => {
                      setEditedUseCaseText(project.useCase || "");
                      setIsEditingUseCase(true);
                    }}
                    className="px-2.5 py-1 text-xs font-bold rounded-lg border border-border bg-surface hover:bg-surface-muted text-primary cursor-pointer transition-colors"
                  >
                    Edit Use Case
                  </button>
                )}
              </div>

              {isEditingUseCase ? (
                <div className="flex flex-col gap-3">
                  <textarea
                    value={editedUseCaseText}
                    onChange={(e) => setEditedUseCaseText(e.target.value)}
                    rows={4}
                    className="w-full text-xs p-3 rounded-xl border border-border bg-surface-muted text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                    placeholder="Describe your use case goals..."
                  />
                  <div className="flex items-center justify-end gap-2 flex-wrap">
                    <button
                      onClick={() => setIsEditingUseCase(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (onSaveUseCase) await onSaveUseCase(editedUseCaseText);
                        setIsEditingUseCase(false);
                      }}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground cursor-pointer"
                    >
                      Save Only
                    </button>
                    <button
                      onClick={async () => {
                        if (onSaveUseCase) await onSaveUseCase(editedUseCaseText);
                        setIsEditingUseCase(false);
                        if (onReRunWorkflow) {
                          onReRunWorkflow(editedUseCaseText);
                        } else {
                          onRunWorkflow();
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer shadow-sm"
                    >
                      Save & Re-Run Workflow
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {project.useCase
                      ? project.useCase.replace(/[#*`_[\]]/g, "")
                      : "Analyze sales trends, top-performing regions, and product effectiveness across all channels."}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Workflow Pipeline */}
          <WorkflowPipeline
            pipelineStatuses={pipelineStatuses}
            completionPercentage={completionPercentage}
            runStatus={runStatus}
            lastRunTime={lastRunTime}
            activeStage={activeStage}
            stageOutputs={stageOutputs}
            requiresApproval={requiresApproval}
            workflowMessage={workflowMessage}
            onRunWorkflow={onRunWorkflow}
            onReRunWorkflow={onReRunWorkflow ? () => onReRunWorkflow() : undefined}
            onStopWorkflow={onStopWorkflow}
            onViewHistory={onViewHistory}
            onSelectStage={handleSelectStage}
            onApprove={onApprove}
            onRetry={onRetry}
          />
        </div>
      </div>
      {(() => {
        const stepOutputs: Record<string, React.ReactNode> = {
          "Data Ingestion": (stageOutputs.inspect || stageOutputs.inspectNode) ? (
            <IngestionStepOutput inspectOutput={stageOutputs.inspect || stageOutputs.inspectNode} />
          ) : null,
          "Data Profiling": (stageOutputs.profileData || stageOutputs.preprocess) ? (
            <ProfilingStepOutput profileData={stageOutputs.profileData} preprocess={stageOutputs.preprocess} />
          ) : null,
          "Schema Resolver": stageOutputs.resolveSchema ? (
            <SchemaResolverStepOutput resolveSchema={stageOutputs.resolveSchema} />
          ) : null,
        };

        return (
          <CardModal 
            isOpen={isExecutionModalOpen}
            onClose={() => setIsExecutionModalOpen(false)}
            workflowCard={selectedWorkflow}
            pipelineStatuses={pipelineStatuses}
            stepOutputs={stepOutputs}
            runStatus={runStatus}
            workflowMessage={workflowMessage}
            projectId={project.id}
            agentState={project.agentState}
          />
        );
      })()}
    </>
  );
}
