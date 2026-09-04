"use client";

import React, { useState } from "react";
import { Project, DataSource, UserProfile } from "../providers/AppContext";
import { PipelineStatuses, RunStatus, Workflow } from "./types";
import WorkflowPipeline, { getMainStepId } from "./WorkflowPipeline";
import CardModal from "../shared/ui/CardModal";
import { PIPELINE_STEPS } from "./constants";
import IngestionStepOutput from "./pipeline-outputs/IngestionStepOutput";
import ProfilingStepOutput from "./pipeline-outputs/ProfilingStepOutput";
import SchemaResolverStepOutput from "./pipeline-outputs/SchemaResolverStepOutput";
import ExogenousScoutStepOutput from "./pipeline-outputs/ExogenousScoutStepOutput";
import HierarchyMapperStepOutput from "./pipeline-outputs/HierarchyMapperStepOutput";
import FeatureArchitectStepOutput from "./pipeline-outputs/FeatureArchitectStepOutput";
import FeatureValidatorStepOutput from "./pipeline-outputs/FeatureValidatorStepOutput";
import ModelTrainingValidationStepOutput from "./pipeline-outputs/ModelTrainingValidationStepOutput";

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
  isPaused?: boolean;
  pausedAtPhase?: string | null;
  onPause?: () => void;
  onResume?: () => void;
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
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
  isPaused,
  pausedAtPhase,
  onPause,
  onResume,
  agentThinking,
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
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8">
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

            {/* Domain & Sub-domain inline pills */}
            {(project.domain || project.subDomain) && (
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                {project.domain && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary text-white shadow-sm">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-white">
                      <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
                    </svg>
                    {project.domain}
                  </span>
                )}
                {project.subDomain && (
                  <>
                    <span className="text-muted-foreground/40 text-xs select-none">›</span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/90 text-white shadow-sm">
                      {project.subDomain}
                    </span>
                  </>
                )}
              </div>
            )}
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

        {/* ── Main Layout Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* Left Column: Data Sources & Use Case — flat, no card wrappers */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-3 flex flex-col gap-8">

            {/* ── Data Sources Section ── */}
            <div className="border border-border rounded-lg shadow-sm bg-background p-5">
              {/* Header with divider */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
                <div>
                  <h2 className="text-base font-bold text-foreground leading-tight">
                    Data Sources ({displaySources.length})
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Connected to this project.</p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {displaySources.map((ds) => {
                  const category = (() => {
                    const s = ds.subtext.toLowerCase();
                    if (s.includes("warehouse")) return "Warehouse";
                    if (s.includes("database")) return "Database";
                    if (s.includes("api")) return "API";
                    if (s.includes("cloud") || s.includes("storage")) return "Cloud";
                    if (s.includes("file")) return "File";
                    return "Database";
                  })();
                  const detail = ds.connectionConfig?.host
                    ? `${ds.connectionConfig.database ?? "Database"} · ${ds.connectionConfig.host}${ds.connectionConfig.port ? `:${ds.connectionConfig.port}` : ""}`
                    : ds.connectionConfig?.fileName ?? category;

                  return (
                    <div
                      key={ds.id}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border hover:border-border/80 transition-colors"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-surface-muted border border-border flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground uppercase">
                          {ds.name.slice(0, 2)}
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground truncate max-w-[120px]" title={ds.name}>
                              {ds.name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-surface-muted border border-border text-[9px] font-semibold text-muted-foreground uppercase shrink-0">
                              {category}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground truncate mt-0.5" title={detail}>{detail}</span>
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            Connected
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() =>
                          showAlert({
                            title: ds.name,
                            message: `Connector properties for ${ds.name}. Details: ${JSON.stringify(ds.connectionConfig ?? {})}`,
                            type: "info",
                          })
                        }
                        className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-surface-muted hover:border-border/60 flex items-center justify-center cursor-pointer transition-colors shrink-0 focus:outline-none"
                        title="View details"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 mt-1 border-t border-border">
                <button
                  onClick={onManageSources}
                  className="w-full py-2 border border-dashed border-border hover:border-primary text-muted-foreground hover:text-primary rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center justify-center gap-2"
                >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.62V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Manage Data Sources
                </button>
              </div>
            </div>

            {/* ── Use Case Section ── */}
            <div className="border border-border rounded-lg shadow-sm bg-background p-5">
              {/* Header with divider */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
                <h2 className="text-base font-bold text-foreground leading-tight">Project Use Case</h2>
                {!isEditingUseCase && (
                  <button
                    onClick={() => {
                      setEditedUseCaseText(project.useCase || "");
                      setIsEditingUseCase(true);
                    }}
                    className="px-3 py-1 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 cursor-pointer transition-colors shadow-sm"
                  >
                    Edit
                  </button>
                )}
              </div>

              {isEditingUseCase ? (
                <div className="flex flex-col gap-3">
                  <textarea
                    value={editedUseCaseText}
                    onChange={(e) => setEditedUseCaseText(e.target.value)}
                    rows={4}
                    className="w-full text-xs p-3 rounded-xl border border-border bg-surface-muted text-foreground focus:outline-none focus:ring-0 resize-y"
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
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground cursor-pointer"
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
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer shadow-sm"
                    >
                      Save & Re-Run Workflow
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {project.useCase
                    ? project.useCase.replace(/[#*`_[\]]/g, "")
                    : "Analyze sales trends, top-performing regions, and product effectiveness across all channels."}
                </p>
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
            isPaused={isPaused}
            pausedAtPhase={pausedAtPhase}
            onPause={onPause}
            onResume={onResume}
          />
        </div>
      </div>
      {(() => {
        const stepOutputs: Record<string, React.ReactNode> = {
          "Data Inspection": (stageOutputs.inspect || stageOutputs.inspectNode) ? (
            <IngestionStepOutput inspectOutput={stageOutputs.inspect || stageOutputs.inspectNode} />
          ) : null,
          "Data Profiling": (stageOutputs.profileData || stageOutputs.preprocess) ? (
            <ProfilingStepOutput profileData={stageOutputs.profileData} preprocess={stageOutputs.preprocess} />
          ) : null,
          "Schema Resolver": stageOutputs.resolveSchema ? (
            <SchemaResolverStepOutput resolveSchema={stageOutputs.resolveSchema} />
          ) : null,
          "Hierarchy Mapper": (stageOutputs.hierarchyMapper || stageOutputs.relationshipBuilder || stageOutputs.formBuilder) ? (
            <HierarchyMapperStepOutput
              hierarchyMapper={stageOutputs.hierarchyMapper}
              relationshipBuilder={stageOutputs.relationshipBuilder}
              formBuilder={stageOutputs.formBuilder}
            />
          ) : null,
          "Feature Architect": stageOutputs.featureArchitect ? (
            <FeatureArchitectStepOutput featureArchitect={stageOutputs.featureArchitect} />
          ) : null,
          "Feature Validator": (stageOutputs.featureValidator || (stageOutputs.featureArchitect as any)?.featureValidator) ? (
            <FeatureValidatorStepOutput
              featureValidator={stageOutputs.featureValidator || (stageOutputs.featureArchitect as any)?.featureValidator}
            />
          ) : null,
          "Exogenous Scout": stageOutputs.exogenousScout ? (
            <ExogenousScoutStepOutput exogenousScout={stageOutputs.exogenousScout} />
          ) : null,
          "Model Selection": stageOutputs.modelTraining ? (
            <ModelTrainingValidationStepOutput />
          ) : null,
          "Training Configuration": stageOutputs.modelTraining ? (
            <ModelTrainingValidationStepOutput />
          ) : null,
          "Model Training": stageOutputs.modelTraining ? (
            <ModelTrainingValidationStepOutput />
          ) : null,
          "Model Validation": stageOutputs.modelTraining ? (
            <ModelTrainingValidationStepOutput />
          ) : null
        };
        console.log(stageOutputs)

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
            agentThinking={agentThinking}
          />
        );
      })()}
    </>
  );
}
