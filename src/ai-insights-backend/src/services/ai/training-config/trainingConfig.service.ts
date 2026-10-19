import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  ITrainingConfigService,
  TrainingContractResult,
  SaveTrainingContractResult,
  DateRangeResult,
} from "./trainingConfig.service.interface";
import { ProjectService } from "../../project/project.service";
import {
  resolveProjectRunTimestamp,
  syncTrainingConfigSplitDate,
} from "../../../agents/tools/helpers/schemaHelper";
import { normalizeFlatStageStatuses } from "../../../agents/pipelineNames";
import { TrainingConfigValidator } from "../../../agents/ModelTrainingValidation/TrainingConfiguration/trainingConfigValidator";

export class TrainingConfigService implements ITrainingConfigService {
  constructor(private projectService: ProjectService) {}

  private requireCompletedTrainingConfiguration(agentState: any, timestamp?: string): void {
    if (timestamp && agentState?.runTimestamp !== timestamp) {
      throw new Error(`Training configuration is unavailable for run "${timestamp}".`);
    }
    const output = agentState?.stageOutputs?.trainingConfigurationNode;
    const nodeStatus = normalizeFlatStageStatuses(agentState?.stageStatuses).trainingConfigurationNode;
    if (nodeStatus !== "Completed") {
      throw new Error("Training configuration is not available until the backend completes the training configuration step.");
    }
  }

  public async getContract(projectId: string, timestamp?: string): Promise<TrainingContractResult> {
    const pWs = await this.projectService.getProjectWithWorkspace(projectId);
    if (!pWs || !pWs.project) {
      throw new Error(`Project "${projectId}" not found`);
    }

    const workspaceName = pWs.workspaceName || "DefaultWorkspace";
    const projectName = pWs.project.name;
    const existingAgentState = (pWs.project.agentState as any) || {};
    this.requireCompletedTrainingConfiguration(existingAgentState, timestamp);
    const effectiveTs = resolveProjectRunTimestamp(
      workspaceName,
      projectName,
      timestamp || existingAgentState.runTimestamp
    );

    const output = existingAgentState.stageOutputs.trainingConfigurationNode;
    const contractPath = output.contractPath as string | undefined;
    const filename = output.contractFileName || (contractPath ? path.basename(contractPath) : "");

    if (contractPath && fsSync.existsSync(contractPath)) {
      const content = await fs.readFile(contractPath, "utf-8");
      let parsed: Record<string, any> = {};
      try {
        parsed = (yaml.load(content) as Record<string, any>) || {};
      } catch (e: any) {
        throw new Error(`Training configuration contract is invalid YAML at ${contractPath}: ${e?.message || e}`);
      }
      return {
        yamlContent: content,
        parsedConfig: parsed,
        filePath: contractPath,
        filename,
      };
    }

    throw new Error(`Training Job Contract from the completed backend output could not be located for project "${projectId}"`);
  }

  public async saveContract(
    projectId: string,
    yamlContent: string,
    timestamp?: string
  ): Promise<SaveTrainingContractResult> {
    if (!yamlContent || typeof yamlContent !== "string" || yamlContent.trim().length === 0) {
      throw new Error("YAML content cannot be empty");
    }

    let parsed: Record<string, any>;
    try {
      parsed = yaml.load(yamlContent) as Record<string, any>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("YAML content must evaluate to a valid object");
      }
    } catch (err: any) {
      throw new Error(`YAML syntax error: ${err?.message || err}`);
    }
    const validation = TrainingConfigValidator.validate(parsed);
    if (!validation.isValid) throw new Error(`Invalid Training Configuration:\n${validation.errors.join("\n")}`);

    const pWs = await this.projectService.getProjectWithWorkspace(projectId);
    if (!pWs || !pWs.project) {
      throw new Error(`Project "${projectId}" not found`);
    }

    const existingAgentState = (pWs.project.agentState as any) || {};
    this.requireCompletedTrainingConfiguration(existingAgentState, timestamp);
    const filePath = existingAgentState.stageOutputs.trainingConfigurationNode.contractPath;
    if (typeof filePath !== "string" || !filePath.trim() || !fsSync.existsSync(filePath)) {
      throw new Error("The active Training Configuration contract file is unavailable.");
    }
    const filename = path.basename(filePath);

    await fs.writeFile(filePath, yamlContent, "utf-8");
    console.info(`[TrainingConfigService] Successfully saved YAML contract to file server at: ${filePath}`);

    const splitFromParsed =
      parsed.split?.split_date ||
      parsed.splitDate ||
      parsed.splitEndDate ||
      parsed.split?.temporal?.train_end;
    const trainingConfigPayload: any = {
      ...(existingAgentState.trainingConfiguration || {}),
      status: "Completed",
      configuration: parsed,
      contractPath: filePath,
      contractFileName: filename,
      updatedAt: new Date().toISOString(),
      ...(splitFromParsed ? { splitDate: splitFromParsed, splitEndDate: splitFromParsed } : {}),
    };
    const updatedState: any = {
      ...existingAgentState,
      trainingConfiguration: trainingConfigPayload,
      stageOutputs: {
        ...(existingAgentState.stageOutputs || {}),
        trainingConfigurationNode: trainingConfigPayload,
      },
      ...(splitFromParsed ? { splitDate: splitFromParsed, splitEndDate: splitFromParsed } : {}),
    };
    await this.projectService.updateAgentState(projectId, updatedState);

    return {
      success: true,
      filePath,
      filename,
      parsedConfig: parsed,
    };
  }

  public async syncSplitDate(
    projectId: string,
    splitDate: string,
    timestamp?: string
  ): Promise<SaveTrainingContractResult> {
    if (!splitDate.trim()) {
      throw new Error("A split date is required.");
    }
    const pWs = await this.projectService.getProjectWithWorkspace(projectId);
    if (!pWs?.project) {
      throw new Error(`Project "${projectId}" not found`);
    }
    const agentState = (pWs.project.agentState as any) || {};
    this.requireCompletedTrainingConfiguration(agentState, timestamp);
    const effectiveTs = resolveProjectRunTimestamp(
      pWs.workspaceName || "DefaultWorkspace",
      pWs.project.name,
      timestamp || agentState.runTimestamp
    );
    const result = await syncTrainingConfigSplitDate(
      pWs.workspaceName || "DefaultWorkspace",
      pWs.project.name,
      splitDate,
      agentState,
      effectiveTs
    );
    if (!result.contractPath) {
      throw new Error("Training configuration contract was not synchronized.");
    }

    await this.projectService.updateAgentState(projectId, result.updatedState);
    const yamlContent = await fs.readFile(result.contractPath, "utf-8");
    return {
      success: true,
      filePath: result.contractPath,
      filename: path.basename(result.contractPath),
      parsedConfig: (yaml.load(yamlContent) as Record<string, any>) || {},
    };
  }

  public async getDateRange(projectId: string, timestamp?: string): Promise<DateRangeResult> {
    const pWs = await this.projectService.getProjectWithWorkspace(projectId);
    if (!pWs || !pWs.project) {
      throw new Error(`Project "${projectId}" not found`);
    }

    const workspaceName = pWs.workspaceName || "DefaultWorkspace";
    const projectName = pWs.project.name;
    const existingAgentState = (pWs.project.agentState as any) || {};
    this.requireCompletedTrainingConfiguration(existingAgentState, timestamp);

    const { extractDatasetDateRange } = await import("../../../agents/tools/helpers/datasetDateRangeHelper");
    return await extractDatasetDateRange(workspaceName, projectName, timestamp, existingAgentState);
  }
}
