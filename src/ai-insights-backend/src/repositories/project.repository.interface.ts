import { Project } from "../models/project.types";

export interface IProjectRepository {
  getById(id: string): Promise<Project | undefined>;
  updateAgentState(id: string, agentState: Record<string, unknown>): Promise<Project | undefined>;
}
