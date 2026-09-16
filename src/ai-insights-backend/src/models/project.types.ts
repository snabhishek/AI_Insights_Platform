export interface Project {
  id: string;
  projectName: string;
  useCaseName: string;
  role: "OWNER" | "MEMBER";
  dataSources: string[];
  initials: string;
  workspaceId: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
  folderPath?: string;
  status?: string;
  agentState?: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectRun {
  id: string;
  projectId: string;
  useCase?: string;
  status?: string;
  agentState: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectWithWorkspace {
  project: Project;
  workspaceName: string;
}

