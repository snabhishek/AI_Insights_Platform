"use client";

import React, { useState } from "react";
import { Project, DataSource, UserProfile } from "../providers/AppContext";
import { PipelineStatuses, RunStatus, StageOutputs, Workflow, WorkflowAgentState } from "./types";
import WorkflowPipeline, { getMainStepId, toDisplayStatuses } from "./WorkflowPipeline";
import CardModal from "../shared/ui/CardModal";
import { PIPELINE_STEPS } from "./constants";
import { normalizeStageOutputs } from "./pipelineNames";
import IngestionStepOutput from "./pipeline-outputs/IngestionStepOutput";
import ProfilingStepOutput from "./pipeline-outputs/ProfilingStepOutput";
import SchemaResolverStepOutput from "./pipeline-outputs/SchemaResolverStepOutput";
import ExogenousScoutStepOutput from "./pipeline-outputs/ExogenousScoutStepOutput";
import HierarchyMapperStepOutput from "./pipeline-outputs/HierarchyMapperStepOutput";
import FeatureArchitectStepOutput from "./pipeline-outputs/FeatureArchitectStepOutput";
import FeatureValidatorStepOutput from "./pipeline-outputs/FeatureValidatorStepOutput";
import ModelTrainingValidationStepOutput from "./pipeline-outputs/ModelTrainingValidationStepOutput";

type AlertType = "error" | "success" | "info";

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

  onManageSources: () => void;
  onAddTag: () => void;
  activeStage: string | null;
  stageOutputs: StageOutputs;
  workflowMessage: string;
  onSelectStage: (stepId: string) => void;
  onApprove: (
    overrideTargetPhase?: string,
    selectedModels?: string[],
    splitEndDate?: string,
    predictionHorizon?: number,
    predictionFrequency?: string,
    predictionObjectiveStartDate?: string
  ) => void;
  onRetry: (stepId: string) => void;
  isPaused?: boolean;
  pausedAtPhase?: string | null;
  onPause?: () => void;
  onResume?: () => void;
  approvalNextStep?: string | null;
  isApproving?: boolean;
  isAwaitingResponse?: boolean;
  isSubmittingWorkflow?: boolean;
  isPausing?: boolean;
  isStopping?: boolean;
  isResuming?: boolean;
  isRetrying?: boolean;
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
  showAlert: (opts: { title: string; message?: string; type: AlertType; logs?: string }) => void;
}

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

  onManageSources,
  onAddTag,
  activeStage,
  stageOutputs,
  workflowMessage,
  onSelectStage,
  onApprove,
  onRetry,
  isPaused,
  pausedAtPhase,
  onPause,
  onResume,
  approvalNextStep,
  isApproving,
  isAwaitingResponse,
  isSubmittingWorkflow,
  isPausing,
  isStopping,
  isResuming,
  isRetrying,
  agentThinking,
  showAlert,
}: ProjectDetailPageProps) {
  const [isEditingUseCase, setIsEditingUseCase] = React.useState(false);
  const [editedUseCaseText, setEditedUseCaseText] = React.useState(project.useCase || "");
  const [isExecutionModalOpen, setIsExecutionModalOpen] = useState<boolean>(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [selectedSubstepId, setSelectedSubstepId] = useState<string | null>(null);
  const displayPipelineStatuses = toDisplayStatuses(pipelineStatuses);

  React.useEffect(() => {
    setEditedUseCaseText(project.useCase || "");
  }, [project.useCase]);

  const handleSelectStage = (stepId: string) => {
    const mainId = getMainStepId(stepId);
    onSelectStage(mainId);
    const match = PIPELINE_STEPS.find((item) => item.id === mainId);
    if (match) {
      setSelectedWorkflow(match);
      if (stepId !== mainId) {
        setSelectedSubstepId(stepId);
      } else if (mainId === "modelTrainingValidation") {
        const substeps = [
          ["modelTrainingExecNode", "Model Training"],
          ["preFlightNode", "Pre Flight"],
          ["trainingConfigurationNode", "Training Configuration"],
          ["modelSelectionNode", "Model Selection"],
        ] as const;
        const inProgress = substeps.find(([key]) => displayPipelineStatuses[key] === "In-Progress");
        const withOutput = substeps.find(
          ([key]) => stageOutputs?.[key] != null || displayPipelineStatuses[key] === "Completed"
        );
        setSelectedSubstepId(inProgress?.[0] || withOutput?.[0] || "modelSelectionNode");
      } else {
        setSelectedSubstepId(null);
      }
      setIsExecutionModalOpen(true);
    }
  };

  const projectSources = allDataSources.filter((ds) =>
    project.dataSources.includes(ds.id)
  );
  const displaySources = projectSources;

  return (
    <>
      <div className="p-4 w-full flex flex-col min-h-full bg-background animate-fade-in select-none">

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
                {project.projectName || project.name}
              </h1>

              {project.projectName && (
                <span className="text-sm text-muted-foreground font-medium">
                  {project.name}
                </span>
              )}

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
          </div>

        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 items-start gap-3">

          <div className="col-span-12 lg:col-span-4 xl:col-span-3 flex flex-col gap-3">

            <div className="border border-border rounded-lg shadow-sm bg-background p-5">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
                <div>
                  <h2 className="text-base font-bold text-foreground leading-tight">
                    Connectors ({displaySources.length})
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
                  Manage Connectors
                </button>
              </div>
            </div>

            <div className="border border-border rounded-lg shadow-sm bg-background p-5">
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
                      type="button"
                      disabled={isSubmittingWorkflow || isApproving || isPausing || isStopping || isResuming}
                      onClick={async () => {
                        if (onSaveUseCase) await onSaveUseCase(editedUseCaseText);
                        setIsEditingUseCase(false);
                        if (onReRunWorkflow) {
                          onReRunWorkflow(editedUseCaseText);
                        } else {
                          onRunWorkflow();
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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

          <WorkflowPipeline
            pipelineStatuses={pipelineStatuses}
            completionPercentage={completionPercentage}
            runStatus={runStatus}
            lastRunTime={lastRunTime}
            activeStage={activeStage}
            stageOutputs={stageOutputs}
            workflowMessage={workflowMessage}
            onRunWorkflow={onRunWorkflow}
            onReRunWorkflow={onReRunWorkflow ? () => onReRunWorkflow() : undefined}
            onStopWorkflow={onStopWorkflow}

            onSelectStage={handleSelectStage}
            onApprove={() => onApprove()}
            onRetry={onRetry}
            isPaused={isPaused}
            pausedAtPhase={pausedAtPhase}
            onPause={onPause}
            onResume={onResume}
            isApproving={isApproving}
            isSubmittingWorkflow={isSubmittingWorkflow}
            isPausing={isPausing}
            isStopping={isStopping}
            isResuming={isResuming}
            isRetrying={isRetrying}
            isAwaitingResponse={isAwaitingResponse}
            approvalNextStep={approvalNextStep}
          />
        </div>
      </div>
      {(() => {
        const savedAgentState: WorkflowAgentState = project.agentState || {};
        const savedOutputs = normalizeStageOutputs(savedAgentState.stageOutputs);
        const currentOutputs = normalizeStageOutputs(stageOutputs);
        const allowLegacyOutputFallback =
          savedAgentState.stageOutputs === undefined && runStatus !== "In-Progress";

        const effectiveInspect = currentOutputs.inspect || savedOutputs.inspect ||
          (allowLegacyOutputFallback ? savedAgentState.inspection || savedAgentState.inspect : undefined);
        const effectiveProfileData = currentOutputs.profileData || savedOutputs.profileData ||
          (allowLegacyOutputFallback ? savedAgentState.dataProfile || savedAgentState.profileData : undefined);
        const effectiveResolveSchema = currentOutputs.resolveSchema || savedOutputs.resolveSchema ||
          (allowLegacyOutputFallback ? savedAgentState.schemaResolution || savedAgentState.resolveSchema : undefined);
        const effectiveHierarchyMapper = currentOutputs.hierarchyMapperNode || savedOutputs.hierarchyMapperNode ||
          (allowLegacyOutputFallback ? savedAgentState.hierarchyMapperNode || savedAgentState.hierarchyMapper : undefined);
        const effectiveRelationshipBuilder = effectiveHierarchyMapper?.relationshipBuilder;
        const effectiveFormBuilder = effectiveHierarchyMapper?.formBuilder;
        const effectiveFeatureArchitect = currentOutputs.featureArchitectNode || savedOutputs.featureArchitectNode ||
          (allowLegacyOutputFallback ? savedAgentState.featureArchitectNode || savedAgentState.featureArchitect : undefined);
        const effectiveFeatureValidator = currentOutputs.featureValidatorNode || savedOutputs.featureValidatorNode ||
          effectiveFeatureArchitect?.featureValidator ||
          (allowLegacyOutputFallback ? savedAgentState.featureValidatorNode || savedAgentState.featureValidator : undefined);
        const effectiveExogenousScout = currentOutputs.exogenous || savedOutputs.exogenous ||
          (allowLegacyOutputFallback ? savedAgentState.exogenousScout || savedAgentState.exogenous : undefined);
        const effectiveModelSelection = currentOutputs.modelSelectionNode || savedOutputs.modelSelectionNode ||
          (allowLegacyOutputFallback ? savedAgentState.modelSelectionNode || savedAgentState.modelSelection : undefined);
        const effectiveTrainingConfig = currentOutputs.trainingConfigurationNode || savedOutputs.trainingConfigurationNode ||
          (allowLegacyOutputFallback ? savedAgentState.trainingConfigurationNode || savedAgentState.trainingConfiguration : undefined);
        const effectivePreFlight = currentOutputs.preFlightNode || savedOutputs.preFlightNode ||
          (allowLegacyOutputFallback ? savedAgentState.preFlightNode || savedAgentState.preFlight : undefined);
        const effectiveModelTraining = currentOutputs.modelTrainingExecNode || savedOutputs.modelTrainingExecNode ||
          (allowLegacyOutputFallback ? savedAgentState.modelTrainingExecNode || savedAgentState.modelTraining : undefined);
        const effectiveModelValidation = effectiveModelTraining?.modelValidation ||
          (allowLegacyOutputFallback ? savedAgentState.modelValidation : undefined);
        const effectiveRunTimestamp = savedAgentState.runTimestamp;

        const stepOutputs: Record<string, React.ReactNode> = {
          inspect: effectiveInspect ? (
            <IngestionStepOutput inspectOutput={effectiveInspect} />
          ) : null,
          profileData: effectiveProfileData ? (
            <ProfilingStepOutput profileData={effectiveProfileData} />
          ) : null,
          resolveSchema: effectiveResolveSchema ? (
            <SchemaResolverStepOutput resolveSchema={effectiveResolveSchema} />
          ) : null,
          hierarchyMapperNode: (effectiveHierarchyMapper || effectiveRelationshipBuilder || effectiveFormBuilder) ? (
            <HierarchyMapperStepOutput
              hierarchyMapper={effectiveHierarchyMapper}
              relationshipBuilder={effectiveRelationshipBuilder}
              formBuilder={effectiveFormBuilder}
            />
          ) : null,
          featureArchitectNode: effectiveFeatureArchitect ? (
            <FeatureArchitectStepOutput featureArchitect={effectiveFeatureArchitect} />
          ) : null,
          featureValidatorNode: effectiveFeatureValidator ? (
            <FeatureValidatorStepOutput
              featureValidator={effectiveFeatureValidator}
            />
          ) : null,
          exogenous: effectiveExogenousScout ? (
            <ExogenousScoutStepOutput exogenousScout={effectiveExogenousScout} />
          ) : null,
          modelSelectionNode: effectiveModelSelection ? (
            <ModelTrainingValidationStepOutput
              modelSelection={effectiveModelSelection}
              projectId={project.id}
              activeSubstep="Model Selection"
              activeRunTimestamp={effectiveRunTimestamp}
              onSelectionConfirmed={(models) => {
                if (onApprove) {
                  onApprove("Training Configuration", models);
                }
              }}
            />
          ) : null,
          trainingConfigurationNode: effectiveTrainingConfig ? (
            <ModelTrainingValidationStepOutput
              modelSelection={effectiveModelSelection}
              trainingConfiguration={effectiveTrainingConfig}
              projectId={project.id}
              activeSubstep="Training Configuration"
              activeRunTimestamp={effectiveRunTimestamp}
              onApprove={(selectedModels, splitEndDate) => {
                if (onApprove) {
                  onApprove("Pre Flight", selectedModels, splitEndDate);
                }
              }}
              isApproving={isApproving}
            />
          ) : null,
          preFlightNode: effectivePreFlight ? (
            <ModelTrainingValidationStepOutput
              preFlight={effectivePreFlight}
              projectId={project.id}
              activeSubstep="Pre Flight"
              activeRunTimestamp={effectiveRunTimestamp}
              onApprovePreFlight={() => {
                if (onApprove) {
                  onApprove("Model Training");
                }
              }}
              isApproving={isApproving}
            />
          ) : null,
          modelTrainingExecNode: (effectiveModelTraining || effectiveModelSelection) ? (
            <ModelTrainingValidationStepOutput
              modelTraining={effectiveModelTraining}
              trainingConfiguration={effectiveTrainingConfig}
              modelSelection={effectiveModelSelection}
              projectId={project.id}
              activeSubstep="Model Training"
              activeRunTimestamp={effectiveRunTimestamp}
              onApproveTraining={(selectedModels, splitEndDate) => {
                if (onApprove) {
                  onApprove("Model Training", selectedModels, splitEndDate);
                }
              }}
              onApproveValidation={(horizon, frequency, startDate, selectedModels) => {
                if (onApprove) {
                  onApprove("Model Validation", selectedModels, undefined, horizon, frequency, startDate);
                }
              }}
              isApproving={isApproving}
            />
          ) : null,
          modelTrainingCodeNode: null,
          "Model Validation": (effectiveModelValidation || effectiveModelTraining) ? (
            <ModelTrainingValidationStepOutput
              modelValidation={effectiveModelValidation}
              modelTraining={effectiveModelTraining}
              trainingConfiguration={effectiveTrainingConfig}
              modelSelection={effectiveModelSelection}
              projectId={project.id}
              activeSubstep="Model Validation"
              activeRunTimestamp={effectiveRunTimestamp}
              onApproveValidation={(horizon, frequency, startDate, selectedModels) => {
                if (onApprove) {
                  onApprove("Model Validation", selectedModels, undefined, horizon, frequency, startDate);
                }
              }}
              isApproving={isApproving}
            />
          ) : null,
          "Feature Engineering": effectiveExogenousScout ? (
            <ExogenousScoutStepOutput exogenousScout={effectiveExogenousScout} />
          ) : effectiveFeatureArchitect ? (
            <FeatureArchitectStepOutput featureArchitect={effectiveFeatureArchitect} />
          ) : null,

        };

        return (
          <CardModal
            isOpen={isExecutionModalOpen}
            onClose={() => setIsExecutionModalOpen(false)}
            workflowCard={selectedWorkflow}
            selectedSubstepId={selectedSubstepId}
            pipelineStatuses={displayPipelineStatuses}
            stepOutputs={stepOutputs}
            runStatus={runStatus}
            workflowMessage={workflowMessage}
            projectId={project.id}
            agentState={project.agentState}
            agentThinking={agentThinking}
            approvalNextStep={approvalNextStep}
            isApproving={isApproving}
            isAwaitingResponse={isAwaitingResponse}
            onApprove={onApprove}
            onSubstepChange={setSelectedSubstepId}
          />
        );
      })()}
    </>
  );
}
