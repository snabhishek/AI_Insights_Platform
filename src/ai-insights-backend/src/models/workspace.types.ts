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
  name: string;
  role?: "OWNER" | "MEMBER";
  dataSources?: string[];
  initials?: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
}

export interface UpdateProjectDto {
  name?: string;
  useCase?: string;
  dataSources?: string[];
  agentState?: Record<string, unknown>;
}
