import { AgentStateType } from "../agents/state";
import { PipelineStepStatus } from "../agents/pipelineNames";

export interface Project {
  id: string;
  projectName?: string;
  name: string;
  role: "OWNER" | "MEMBER";
  dataSources: string[];
  initials: string;
  workspaceId: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
  folderPath?: string;
  status?: PipelineStepStatus;
  agentState?: AgentStateType | undefined;
  createdAt: string;
}

export interface ProjectRun {
  id: string;
  projectId: string;
  useCase?: string;
  status?: PipelineStepStatus;
  agentState: AgentStateType | undefined;
  createdAt: string;
}

export interface ProjectWithWorkspace {
  project: Project;
  workspaceName: string;
}
