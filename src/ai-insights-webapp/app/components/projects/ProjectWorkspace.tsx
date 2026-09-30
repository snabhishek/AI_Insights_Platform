"use client";

import React, { useState } from "react";
import { DataSource, Project, UserProfile } from "../providers/AppContext";
import { PipelineStatuses, RunStatus } from "./types";
import ProjectCreatePage from "./ProjectCreatePage";
import ProjectDetailPage from "./ProjectDetailPage";
import ValidationPage from "../pages/ValidationPage";
import { createTabContext } from "../providers/TabProvider";
import { ProjectTabType } from "../shared/constants";

export type { ProjectTabType };

const { TabProvider, useTab } = createTabContext<ProjectTabType>();

interface ProjectWorkspaceProps {
  project?: Project;
  dataSources: DataSource[];
  userProfile: UserProfile;
  activeProjectTab?: ProjectTabType;
  onTabChange?: (tab: ProjectTabType) => void;
  onGoToList: () => void;
  onSaveProject: (
    name: string,
    useCase: string,
    sources: string[],
    domain?: string,
    subDomain?: string
  ) => Promise<any>;
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  onAddDataSource: (
    name: string,
    type: DataSource["type"],
    subtext?: string,
    config?: Record<string, any>
  ) => Promise<any>;
  onDeleteProject: (project: Project) => void;
  pipelineStatuses: PipelineStatuses;
  completionPct: number;
  runStatus: RunStatus;
  lastRunTime: string;
  activeStage: string | null;
  stageOutputs: Record<string, any>;
  requiresApproval: boolean;
  workflowMessage: string;
  isApproving: boolean;
  isPaused: boolean;
  pausedAtPhase: string | null;
  approvalNextStep: string | null;
  isAwaitingResponse: boolean;
  agentThinking: Record<string, Array<{ time: string; text: string; done: boolean }>>;
  showAlert: (config: {
    title?: string;
    message?: string;
    type?: "success" | "error" | "info" | "warning";
    logs?: string;
    isModal?: boolean;
  }) => void;
  onRunSimulation: () => void;
  onReRunWorkflow: (startStepId?: string) => void;
  onStopWorkflow: () => void;
  onPauseWorkflow: () => void;
  onResumeWorkflow: () => void;
  onStageSelect: (stageId: string) => void;
  onApprove: (
    override?: string,
    selectedModels?: string[],
    splitStartDate?: string,
    splitEndDate?: string,
    predictionHorizon?: number,
    predictionFrequency?: string,
    predictionObjectiveStartDate?: string
  ) => void;
  onRetry: (stepId?: string) => void;
}

export default function ProjectWorkspace(props: ProjectWorkspaceProps) {
  const initialTab: ProjectTabType =
    props.activeProjectTab || (props.project ? "workflow" : "project-detail");

  return (
    <TabProvider key={props.project?.id || "new-project"} initialTab={initialTab}>
      <ProjectWorkspaceContent {...props} />
    </TabProvider>
  );
}

function ProjectWorkspaceContent({
  project,
  dataSources,
  userProfile,
  onTabChange,
  onGoToList,
  onSaveProject,
  onUpdateProject,
  onAddDataSource,
  onDeleteProject,
  pipelineStatuses,
  completionPct,
  runStatus,
  lastRunTime,
  activeStage,
  stageOutputs,
  requiresApproval,
  workflowMessage,
  isApproving,
  isPaused,
  pausedAtPhase,
  approvalNextStep,
  isAwaitingResponse,
  agentThinking,
  showAlert,
  onRunSimulation,
  onReRunWorkflow,
  onStopWorkflow,
  onPauseWorkflow,
  onResumeWorkflow,
  onStageSelect,
  onApprove,
  onRetry,
}: ProjectWorkspaceProps) {
  const { activeTab, tabswitcher } = useTab("project-detail");
  const [startInEditMode, setStartInEditMode] = useState(false);

  const handleTabChange = (tab: ProjectTabType) => {
    if (tab !== "project-detail") {
      setStartInEditMode(false);
    }
    tabswitcher(tab);
    onTabChange?.(tab);
  };

  return (
    <div className="w-full flex flex-col min-h-full bg-background animate-fade-in">
      {/* Combined Project Page Top Navigation Bar with Underline Tabs */}
      <div className="w-full bg-surface border-b border-border px-4 flex items-center justify-between gap-4 shrink-0 select-none">
        {/* Tabs */}
        <div className="flex items-center gap-1 -mb-[1px]">
          {/* Tab 1: Create Project / Project Detail */}
          <button
            type="button"
            onClick={() => {
              setStartInEditMode(false);
              handleTabChange("project-detail");
            }}
            className={`py-2 px-2 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === "project-detail"
                ? "border-primary text-primary dark:border-indigo-400 dark:text-indigo-400 font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{project ? "Project Detail" : "Create Project"}</span>
          </button>

          {/* Tab 2: Workflow */}
          <button
            type="button"
            disabled={!project}
            onClick={() => {
              if (project) {
                handleTabChange("workflow");
              }
            }}
            title={!project ? "Save the project first to access the Workflow" : "View Project Workflow"}
            className={`py-2 px-2 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              !project
                ? "border-transparent opacity-40 cursor-not-allowed text-muted-foreground"
                : activeTab === "workflow"
                ? "border-primary text-primary dark:border-indigo-400 dark:text-indigo-400 font-bold cursor-pointer"
                : "border-transparent text-muted-foreground hover:text-foreground cursor-pointer"
            }`}
          >
            <span>Workflow</span>
            {!project && (
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-surface-muted text-muted-foreground border border-border">
                Disabled
              </span>
            )}
          </button>

          {/* Tab 3: Validation */}
          <button
            type="button"
            disabled={!project}
            onClick={() => {
              if (project) {
                handleTabChange("validation");
              }
            }}
            title={!project ? "Save the project first to access Validation" : "View Project Validation"}
            className={`py-2 px-2 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              !project
                ? "border-transparent opacity-40 cursor-not-allowed text-muted-foreground"
                : activeTab === "validation"
                ? "border-primary text-primary dark:border-indigo-400 dark:text-indigo-400 font-bold cursor-pointer"
                : "border-transparent text-muted-foreground hover:text-foreground cursor-pointer"
            }`}
          >
            <span>Validation</span>
            {!project && (
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-surface-muted text-muted-foreground border border-border">
                Disabled
              </span>
            )}
          </button>
        </div>

        {/* Right Action: Back to Projects list
        <button
          type="button"
          onClick={onGoToList}
          className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors flex items-center gap-1.5 cursor-pointer py-2"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>All Projects</span>
        </button> */}
      </div>

      {/* Tab Content */}
      <div className="flex-1 w-full">
        {!project || activeTab === "project-detail" ? (
          <ProjectCreatePage
            dataSources={dataSources}
            project={project}
            isWorkflowActiveOrPaused={runStatus === "Running" || runStatus === "Paused" || isPaused}
            startInEditMode={startInEditMode}
            onEditModeChange={setStartInEditMode}
            onCancel={onGoToList}
            onSubmit={onSaveProject}
            onUpdate={onUpdateProject}
            onAddDataSource={onAddDataSource}
            onDelete={project ? () => onDeleteProject(project) : undefined}
          />
        ) : activeTab === "workflow" ? (
          <ProjectDetailPage
            project={project}
            allDataSources={dataSources}
            userProfile={userProfile}
            pipelineStatuses={pipelineStatuses}
            completionPercentage={completionPct}
            runStatus={runStatus}
            lastRunTime={lastRunTime}
            onRunWorkflow={onRunSimulation}
            onReRunWorkflow={onReRunWorkflow}
            onSaveUseCase={(newUseCase) => onUpdateProject(project.id, { useCase: newUseCase })}
            onStopWorkflow={onStopWorkflow}
            onGoBack={onGoToList}
            onDelete={() => onDeleteProject(project)}
            onEdit={() => {
              setStartInEditMode(true);
              handleTabChange("project-detail");
            }}
            onManageSources={() => {
              setStartInEditMode(true);
              handleTabChange("project-detail");
            }}
            onAddTag={() =>
              showAlert({ title: "Tag management is being worked separately in the backend", type: "info" })
            }
            activeStage={activeStage}
            stageOutputs={stageOutputs}
            requiresApproval={requiresApproval}
            workflowMessage={workflowMessage}
            onSelectStage={onStageSelect}
            onApprove={onApprove}
            isApproving={isApproving}
            onRetry={onRetry}
            isPaused={isPaused}
            pausedAtPhase={pausedAtPhase}
            onPause={onPauseWorkflow}
            onResume={onResumeWorkflow}
            approvalNextStep={approvalNextStep}
            isAwaitingResponse={isAwaitingResponse}
            agentThinking={agentThinking}
            showAlert={showAlert}
          />
        ) : (
          <ValidationPage project={project} />
        )}
      </div>
    </div>
  );
}

