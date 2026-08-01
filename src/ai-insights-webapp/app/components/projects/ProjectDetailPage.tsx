"use client";

import React, { useState } from "react";
import { Project, DataSource, UserProfile } from "../providers/AppContext";
import { PipelineStatuses, RunStatus, Workflow } from "./types";
import ProjectDataSources from "./ProjectDataSources";
import WorkflowPipeline, { getMainStepId } from "./WorkflowPipeline";
import CardModal from "../shared/ui/CardModal";
import { PIPELINE_STEPS } from "./constants";
import IngestionStepOutput from "./pipeline-outputs/IngestionStepOutput";
import ProfilingStepOutput from "./pipeline-outputs/ProfilingStepOutput";
import SchemaResolverStepOutput from "./pipeline-outputs/SchemaResolverStepOutput";

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
    const mainId = getMainStepId(stepId);
    onSelectStage(mainId);
    const match = PIPELINE_STEPS.find((item) => item.id === mainId);
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
