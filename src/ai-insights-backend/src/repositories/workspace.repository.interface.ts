import { Workspace } from "../models/workspace.types";

export interface IWorkspaceRepository {
  getAll(): Promise<Workspace[]>;
  getById(id: string): Promise<Workspace | undefined>;
  getByName(name: string): Promise<Workspace | undefined>;
  create(workspace: Workspace): Promise<Workspace>;
  delete(id: string): Promise<boolean>;
}
