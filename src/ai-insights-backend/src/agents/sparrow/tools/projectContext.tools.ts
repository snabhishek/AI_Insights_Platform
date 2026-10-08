import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { ProjectService } from "../../../services/project/project.service";
import { IDuckDBService } from "../../../services/duckdb/duckdb.service.interface";
import { getProjectDir, resolveStoragePath } from "../../../config/fileServer.config";

export interface ProjectContextToolServices {
  projectService: ProjectService;
  duckDBService: IDuckDBService;
}

export const createGetProjectContextTool = (
  projectId: string,
  services: ProjectContextToolServices
) =>
  tool(
    async () => {
      try {
        if (!projectId) {
          return {
            success: false,
            error: "No projectId provided for project context inspection.",
          };
        }

        const project = await services.projectService.getById(projectId);
        if (!project) {
          return {
            success: false,
            error: `Project with ID '${projectId}' not found.`,
          };
        }

        const pWs = await services.projectService.getProjectWithWorkspace(projectId);
        const agentState = (project.agentState || {}) as any;
        const stageStatuses = agentState?.stageStatuses || {};
        const stageOutputs = agentState?.stageOutputs || {};

        const featureArchitect = agentState?.featureArchitect || stageOutputs?.featureArchitect || {};
        const targetColumn =
          featureArchitect?.targetColumn ||
          featureArchitect?.orchestrationDecision?.targetColumn ||
          agentState?.targetColumn ||
          agentState?.prediction_target_column ||
          null;

        const problemType =
          featureArchitect?.problemType ||
          featureArchitect?.orchestrationDecision?.problemType ||
          agentState?.problemType ||
          null;

        const modelSelection = agentState?.modelSelection || stageOutputs?.modelSelection || {};
        const recommendedModel = modelSelection?.recommended_model?.model_id || null;
        const candidates = (modelSelection?.candidates || []).map((c: any) => c.displayName || c.model_id || c);

        return {
          success: true,
          projectId: project.id,
          projectName: project.projectName || project.name,
          workspaceName: pWs?.workspaceName || "Default_Workspace",
          useCase: project.useCase || "Analytical Intelligence",
          domain: project.domain || "General",
          subDomain: project.subDomain || null,
          dataSources: project.dataSources || [],
          pipelineStatus: project.status || "idle",
          targetColumn,
          problemType,
          recommendedModel,
          predictionObjectiveHorizon: agentState.predictionObjectiveHorizon ?? agentState.predictionHorizon,
          predictionObjectiveFrequency: agentState.predictionObjectiveFrequency ?? agentState.predictionFrequency,
          predictionObjectiveStartDate: agentState.predictionObjectiveStartDate ?? agentState.splitDate,
          candidateModels: candidates,
          stageStatuses,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      }
    },
    {
      name: "getProjectContext",
      description: "Retrieves project metadata, domain, target column, ML problem type, data source connectors, and active pipeline status.",
      schema: z.object({}),
    }
  );

export const createGetProjectDataSchemaTool = (
  projectId: string,
  services: ProjectContextToolServices
) =>
  tool(
    async () => {
      try {
        const project = await services.projectService.getById(projectId);
        if (!project) {
          return {
            success: false,
            error: `Project with ID '${projectId}' not found.`,
          };
        }

        const pWs = await services.projectService.getProjectWithWorkspace(projectId);
        const projectName = project.projectName || project.name;
        const workspaceName = pWs?.workspaceName || "Default_Workspace";

        const dbPath = services.duckDBService.getProjectDuckDbPath(projectName, workspaceName);
        const tablesInfo: Array<{ tableName: string; columns: Array<{ name: string; type: string }> }> = [];

        if (fs.existsSync(dbPath)) {
          const rawTables = await services.duckDBService.runQuery(dbPath, "SHOW TABLES");
          for (const row of rawTables) {
            const tableName = row.name || row.tableName || Object.values(row)[0];
            if (typeof tableName === "string") {
              const cleanTable = tableName.replace(/"/g, '""');
              const cols = await services.duckDBService.runQuery(dbPath, `DESCRIBE "${cleanTable}"`);
              tablesInfo.push({
                tableName,
                columns: cols.map((c: any) => ({
                  name: c.column_name || c.name || Object.values(c)[0],
                  type: c.column_type || c.type || "VARCHAR",
                })),
              });
            }
          }
        }

        // Also check if parquet files exist in the project directory
        const projectDir = project.folderPath ? resolveStoragePath(project.folderPath) : getProjectDir(workspaceName, projectName);
        const parquetFiles: string[] = [];
        if (fs.existsSync(projectDir)) {
          const files = fs.readdirSync(projectDir);
          for (const f of files) {
            if (f.endsWith(".parquet") || f.endsWith(".csv")) {
              parquetFiles.push(f);
            }
          }
        }

        return {
          success: true,
          projectId,
          dbPath: fs.existsSync(dbPath) ? dbPath : null,
          tables: tablesInfo,
          dataFiles: parquetFiles,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          tables: [],
        };
      }
    },
    {
      name: "getProjectDataSchema",
      description: "Retrieves table names, columns, data types, and data files available in the project database.",
      schema: z.object({}),
    }
  );
