export interface Project {
  id: string;
  name: string;
  role: "OWNER" | "MEMBER";
  dataSources: string[];
  initials: string;
  workspaceId: string;
  useCase?: string;
  agentState: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectRun {
  id: string;
  projectId: string;
  useCase?: string;
  agentState: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectWithWorkspace {
  project: Project;
  workspaceName: string;
}

