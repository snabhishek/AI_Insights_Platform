import { PipelineStepStatus } from "../agents/pipelineNames";

export interface Workspace {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export interface CreateWorkspaceDto {
  name: string;
}

export interface CreateProjectDto {
  projectName?: string;
  name: string;
  role?: "OWNER" | "MEMBER";
  dataSources?: string[];
  initials?: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
  splitDate?: string;
}

export interface UpdateProjectDto {
  projectName?: string;
  name?: string;
  useCase?: string;
  dataSources?: string[];
  domain?: string;
  subDomain?: string;
  status?: PipelineStepStatus;
  agentState?: Record<string, unknown>;
  replaceAgentState?: boolean;
}
