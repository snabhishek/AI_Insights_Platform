import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  ITrainingConfigService,
  TrainingContractResult,
  SaveTrainingContractResult,
} from "./trainingConfig.service.interface";
import { ProjectService } from "../../project/project.service";
import { getProjectSchemasDir } from "../../../config/fileServer.config";
import {
  getPackagesDir,
  sanitizeName,
  resolveProjectRunTimestamp,
} from "../../../agents/tools/helpers/schemaHelper";

export class TrainingConfigService implements ITrainingConfigService {
  constructor(private projectService: ProjectService) {}

  public async getContract(projectId: string, timestamp?: string): Promise<TrainingContractResult> {
    const pWs = await this.projectService.getProjectWithWorkspace(projectId);
    if (!pWs || !pWs.project) {
      throw new Error(`Project "${projectId}" not found`);
    }

    const workspaceName = pWs.workspaceName || "DefaultWorkspace";
    const projectName = pWs.project.name;
    const cleanProjectTitle = sanitizeName(projectName);
    const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

    const existingAgentState = (pWs.project.agentState as any) || {};
    const effectiveTs = resolveProjectRunTimestamp(
      workspaceName,
      projectName,
      timestamp || existingAgentState.runTimestamp
    );

    const runSchemasDir = getProjectSchemasDir(workspaceName, projectName, effectiveTs);
    let contractPath: string | null = null;
    let filename = `${useCaseSlug}_training_job_contract_${effectiveTs}.yaml`;

    // 1. Try finding contract file in run schemas dir
    if (fsSync.existsSync(runSchemasDir)) {
      const files = await fs.readdir(runSchemasDir);
      const matched = files.find(
        (f) => f.includes("_training_job_contract_") && (f.endsWith(".yaml") || f.endsWith(".yml"))
      );
      if (matched) {
        contractPath = path.resolve(runSchemasDir, matched);
        filename = matched;
      }
    }

    // 2. Try finding contract file in un-timestamped project schemas dir
    if (!contractPath) {
      const globalSchemasDir = getProjectSchemasDir(workspaceName, projectName);
      if (fsSync.existsSync(globalSchemasDir)) {
        const files = await fs.readdir(globalSchemasDir);
        const matched = files.find(
          (f) => f.includes("_training_job_contract_") && (f.endsWith(".yaml") || f.endsWith(".yml"))
        );
        if (matched) {
          contractPath = path.resolve(globalSchemasDir, matched);
          filename = matched;
        }
      }
    }

    // 3. If file exists, read and return
    if (contractPath && fsSync.existsSync(contractPath)) {
      const content = await fs.readFile(contractPath, "utf-8");
      let parsed: Record<string, any> = {};
      try {
        parsed = (yaml.load(content) as Record<string, any>) || {};
      } catch (e: any) {
        console.warn(`[TrainingConfigService] Failed to parse contract YAML from ${contractPath}:`, e?.message || e);
      }
      return {
        yamlContent: content,
        parsedConfig: parsed,
        filePath: contractPath,
        filename,
      };
    }

    // 4. Fallback to base template schema
    const packagesDir = getPackagesDir();
    const templatePath = path.resolve(packagesDir, "Schemas/TrainingJobContract.yaml");
    if (fsSync.existsSync(templatePath)) {
      const templateContent = await fs.readFile(templatePath, "utf-8");
      let parsedTemplate: Record<string, any> = {};
      try {
        parsedTemplate = (yaml.load(templateContent) as Record<string, any>) || {};
      } catch {}
      return {
        yamlContent: templateContent,
        parsedConfig: parsedTemplate,
        filePath: templatePath,
        filename: "TrainingJobContract.yaml",
      };
    }

    throw new Error(`Training Job Contract could not be located for project "${projectId}"`);
  }

  public async saveContract(
    projectId: string,
    yamlContent: string,
    timestamp?: string
  ): Promise<SaveTrainingContractResult> {
    if (!yamlContent || typeof yamlContent !== "string" || yamlContent.trim().length === 0) {
      throw new Error("YAML content cannot be empty");
    }

    // Validate YAML syntax
    let parsed: Record<string, any>;
    try {
      parsed = yaml.load(yamlContent) as Record<string, any>;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("YAML content must evaluate to a valid object");
      }
    } catch (err: any) {
      throw new Error(`YAML syntax error: ${err?.message || err}`);
    }

    const pWs = await this.projectService.getProjectWithWorkspace(projectId);
    if (!pWs || !pWs.project) {
      throw new Error(`Project "${projectId}" not found`);
    }

    const workspaceName = pWs.workspaceName || "DefaultWorkspace";
    const projectName = pWs.project.name;
    const cleanProjectTitle = sanitizeName(projectName);
    const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

    const existingAgentState = (pWs.project.agentState as any) || {};
    const effectiveTs = resolveProjectRunTimestamp(
      workspaceName,
      projectName,
      timestamp || existingAgentState.runTimestamp
    );

    const targetDir = getProjectSchemasDir(workspaceName, projectName, effectiveTs);
    await fs.mkdir(targetDir, { recursive: true });

    const filename = `${useCaseSlug}_training_job_contract_${effectiveTs}.yaml`;
    const filePath = path.resolve(targetDir, filename);

    await fs.writeFile(filePath, yamlContent, "utf-8");
    console.info(`[TrainingConfigService] Successfully saved YAML contract to file server at: ${filePath}`);

    // Update project agentState so frontend and runtime stay synchronized
    try {
      const trainingConfigPayload = {
        ...(existingAgentState.trainingConfiguration || {}),
        configuration: parsed,
        contractPath: filePath,
        contractFileName: filename,
        updatedAt: new Date().toISOString(),
      };

      const updatedState = {
        ...existingAgentState,
        trainingConfiguration: trainingConfigPayload,
        stageOutputs: {
          ...(existingAgentState.stageOutputs || {}),
          trainingConfiguration: trainingConfigPayload,
        },
      };

      await this.projectService.updateAgentState(projectId, updatedState);
    } catch (dbErr: any) {
      console.warn(`[TrainingConfigService] Warning updating project agent state for ${projectId}:`, dbErr?.message || dbErr);
    }

    return {
      success: true,
      filePath,
      filename,
      parsedConfig: parsed,
    };
  }
}
