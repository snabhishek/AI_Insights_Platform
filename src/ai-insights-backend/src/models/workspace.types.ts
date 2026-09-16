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
  projectName: string;
  useCaseName: string;
  role?: "OWNER" | "MEMBER";
  dataSources?: string[];
  initials?: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
}

export interface UpdateProjectDto {
  projectName?: string;
  useCaseName?: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
  dataSources?: string[];
  status?: string;
  agentState?: Record<string, unknown>;
}
