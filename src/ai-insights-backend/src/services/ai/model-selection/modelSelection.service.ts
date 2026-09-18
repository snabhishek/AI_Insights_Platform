import { v4 as uuidv4 } from "uuid";
import { IModelSelectionService } from "./modelSelection.service.interface";
import { IModelSelectionRepository } from "../../../repositories/modelSelection.repository.interface";
import { IModelSelectionLLMService } from "./modelSelectionLLM.service.interface";
import { IModelDiscoveryService } from "./modelDiscovery.service.interface";
import { ModelDiscoveryService } from "./modelDiscovery.service";
import { ProjectService } from "../../project/project.service";
import { saveModularTrainingJobContract } from "../../../agents/tools/helpers";
import {
  defaultModelCapabilityRegistry,
  ModelCapabilityRegistry,
} from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { ModelSelectionContextNormalizer } from "../../../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import { ModelSelectionValidator } from "../../../agents/ModelTrainingValidation/ModelSelection/modelSelectionValidator";
import { IngestionServices } from "../../../agents/state";
import {
  ModelDefinition,
  ModelSelectionDecisionRecord,
  UserSelectionHandoff,
} from "../../../models/modelSelection.types";

export class ModelSelectionService implements IModelSelectionService {
  private agentVersion = "1.0.0";
  private modelCatalogVersion = "1.0.0";

  constructor(
    private repository: IModelSelectionRepository,
    private llmService: IModelSelectionLLMService,
    private projectService: ProjectService,
    private registry: ModelCapabilityRegistry = defaultModelCapabilityRegistry,
    private discoveryService: IModelDiscoveryService = new ModelDiscoveryService(repository)
  ) {}

  public getRegistry(): ModelCapabilityRegistry {
    return this.registry;
  }

  /**
   * Hydrates dynamic models previously saved to PostgreSQL into the in-memory registry.
   */
  private async hydrateDynamicModels(): Promise<void> {
    try {
      const dynamicModels = await this.repository.getDynamicModels();
      if (dynamicModels.length > 0) {
        this.registry.registerDynamicModels(dynamicModels);
      }
    } catch (e: any) {
      console.warn("[ModelSelectionService] Could not hydrate dynamic models from DB:", e?.message || e);
    }
  }

  public async analyze(
    inputContext: any,
    projectId?: string,
    services?: IngestionServices
  ): Promise<ModelSelectionDecisionRecord> {
    const startTime = Date.now();
    const effectiveProjectId = projectId || inputContext.projectId || "default-project";
    const effectiveServices = services || inputContext?.services;

    console.info(`[ModelSelectionService] Starting Model Selection analysis for project ${effectiveProjectId}`);

    // 1. Hydrate previously discovered dynamic models from DB
    await this.hydrateDynamicModels();

    // 2. Normalize input context (leakage context excluded per specification)
    const normalizedContext = ModelSelectionContextNormalizer.normalize({
      ...inputContext,
      projectId: effectiveProjectId,
    });

    // 3. Mandatory Dynamic Model Discovery via Web Search & External Repositories
    try {
      await this.discoveryService.discoverAndRegisterModels(
        normalizedContext,
        this.registry,
        effectiveServices
      );
    } catch (discErr: any) {
      console.warn("[ModelSelectionService] Dynamic model discovery encountered error, continuing with available registry:", discErr?.message || discErr);
    }

    // 4. Invoke LLM Service with prompt from prompts/ModelSelection/modelSelection.md and search tools
    const decision = await this.llmService.generateDecision(normalizedContext, this.registry, {
      services: effectiveServices,
    });

    // 5. Ensure any candidate in decision is registered with proper source metadata
    if (Array.isArray(decision.candidates)) {
      for (const c of decision.candidates) {
        const existingModel = this.registry.getModel(c.model_id);
        const sourceTypeId = c.source_type_id || existingModel?.sourceTypeId || "external";
        const source = c.source || existingModel?.source || "web_search";
        const repoUrl = c.repository_url || existingModel?.repositoryUrl || null;
        const repoId = c.repository_id || existingModel?.repositoryId || null;

        c.source_type_id = sourceTypeId;
        c.source_type = sourceTypeId === "builtin" ? "builtin" : "external";
        c.source = source;
        c.repository_url = repoUrl;
        c.repository_id = repoId;

        if (!this.registry.isModelSupported(c.model_id)) {
          const inferred = ModelSelectionContextNormalizer.inferProblemSpecs(normalizedContext);
          const newDef: ModelDefinition = {
            modelId: c.model_id,
            displayName: c.displayName || c.model_id,
            algorithm: c.algorithm || c.displayName || "Machine Learning Model",
            framework: c.framework || "custom",
            supportedTasks: [inferred.task],
            supportedSubTasks: [],
            supportedPredictionTypes: ["point", "value"],
            capabilities: ["numerical_features"],
            strengths: c.reasoning?.strengths || ["Discovered candidate model"],
            weaknesses: c.reasoning?.weaknesses || [],
            isBaseline: false,
            isDynamic: true,
            sourceTypeId,
            sourceType: sourceTypeId === "builtin" ? "builtin" : "external",
            source,
            repositoryUrl: repoUrl,
            repositoryId: repoId,
            discoveredAt: c.discovered_at || new Date().toISOString(),
          };
          this.registry.registerModel(newDef);
          try {
            await this.repository.saveDynamicModel(newDef);
          } catch (regErr: any) {
            console.warn(`[ModelSelectionService] Failed to persist candidate model "${c.model_id}" to DB:`, regErr?.message || regErr);
          }
        }
      }
    }

    if (decision.recommended_model) {
      const rec = decision.recommended_model;
      const matched = this.registry.getModel(rec.model_id);
      rec.source_type_id = matched?.sourceTypeId || "external";
      rec.source_type = matched?.sourceType || "external";
      rec.source = matched?.source || "web_search";
      rec.repository_url = matched?.repositoryUrl || null;
      rec.repository_id = matched?.repositoryId || null;
      rec.version = matched?.version || null;
      rec.license = matched?.license || null;
    }

    // 5. Deterministic Validation
    const validation = ModelSelectionValidator.validate(decision, this.registry);
    if (!validation.isValid) {
      console.error("[ModelSelectionService] Decision validation failed:", validation.errors);
      throw new Error(`Model Selection Decision validation failed: ${validation.errors.join("; ")}`);
    }

    const durationMs = Date.now() - startTime;
    const decisionId = `msd-${uuidv4()}`;

    // 6. Build persistent decision record
    const record: ModelSelectionDecisionRecord = {
      id: decisionId,
      projectId: effectiveProjectId,
      useCase: normalizedContext.businessContext.useCase,
      status: decision.status,
      datasetVersion: inputContext.runTimestamp || new Date().toISOString(),
      featureSetVersion: inputContext.featureSetVersion || "v1",
      modelCatalogVersion: this.modelCatalogVersion,
      promptVersion: this.llmService.getPromptVersion(),
      agentVersion: this.agentVersion,
      llmProvider: process.env.AI_PROVIDER || "openai",
      llmModel: process.env.OPENAI_MODEL || process.env.GEMINI_MODEL || "default",
      executionDurationMs: durationMs,
      candidateCount: decision.candidates?.length || 0,
      primaryModelId: decision.recommended_model?.model_id || "",
      inputContextSnapshot: normalizedContext,
      decision,
      isStale: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 7. Persist decision to database
    await this.repository.saveDecision(record);
    console.info(`[ModelSelectionService] Persisted Model Selection Decision ${decisionId} in ${durationMs}ms`);

    // 8. Update project agent state if projectId provided
    if (effectiveProjectId) {
      try {
        const project = await this.projectService.getById(effectiveProjectId);
        const existingState = (project?.agentState as any) || {};

        const updatedState = {
          ...existingState,
          modelSelection: decision,
          stageOutputs: {
            ...(existingState.stageOutputs || {}),
            modelSelection: decision,
          },
          stageStatuses: {
            ...(existingState.stageStatuses || {}),
            modelSelection: "Completed",
          },
        };

        await this.projectService.updateAgentState(effectiveProjectId, updatedState, normalizedContext.businessContext.useCase);
      } catch (projErr: any) {
        console.warn(`[ModelSelectionService] Could not update project agentState for ${effectiveProjectId}:`, projErr?.message || projErr);
      }

      // Persist modular Training Job Contract YAML into project run folder
      try {
        const pWs = await this.projectService.getProjectWithWorkspace(effectiveProjectId);
        if (pWs && pWs.project) {
          await saveModularTrainingJobContract(
            pWs.workspaceName || "DefaultWorkspace",
            pWs.project.name,
            decision,
            inputContext.runTimestamp
          );
        }
      } catch (contractErr: any) {
        console.warn(`[ModelSelectionService] Warning saving Training Job Contract for ${effectiveProjectId}:`, contractErr?.message || contractErr);
      }
    }

    return record;
  }

  public async getDecision(id: string): Promise<ModelSelectionDecisionRecord | undefined> {
    return this.repository.getById(id);
  }

  public async getLatestProjectDecision(projectId: string): Promise<ModelSelectionDecisionRecord | undefined> {
    return this.repository.getLatestByProjectId(projectId);
  }

  public async recordUserSelection(
    decisionId: string,
    selectedModelIds: string[]
  ): Promise<ModelSelectionDecisionRecord> {
    const record = await this.repository.getById(decisionId);
    if (!record) {
      throw new Error(`Model Selection Decision "${decisionId}" not found`);
    }

    if (!Array.isArray(selectedModelIds) || selectedModelIds.length === 0) {
      throw new Error("Must select at least one candidate model for training");
    }

    // Validate that all user-selected model IDs exist in the agent's candidates list
    const candidateIds = new Set((record.decision.candidates || []).map((c) => c.model_id.toLowerCase().trim()));
    for (const sel of selectedModelIds) {
      if (!candidateIds.has(sel.toLowerCase().trim())) {
        throw new Error(`Selected model "${sel}" is not in the recommended candidates list`);
      }
    }

    const userSelection: UserSelectionHandoff = {
      selectedModelIds,
      confirmedAt: new Date().toISOString(),
    };

    // Update the decision record without mutating original recommendation
    const updatedRecord = await this.repository.updateUserSelection(decisionId, userSelection);

    // Perform handoff to Training Configuration in the project's agentState
    if (record.projectId) {
      try {
        const project = await this.projectService.getById(record.projectId);
        const existingState = (project?.agentState as any) || {};

        const trainingConfigPayload = {
          ...(existingState.trainingConfiguration || {}),
          status: "Pending",
          models: selectedModelIds,
          candidate_models: selectedModelIds,
          selectedByUserAt: userSelection.confirmedAt,
          sourceDecisionId: decisionId,
        };

        const updatedState = {
          ...existingState,
          trainingConfiguration: trainingConfigPayload,
          stageOutputs: {
            ...(existingState.stageOutputs || {}),
            trainingConfiguration: trainingConfigPayload,
          },
          stageStatuses: {
            ...(existingState.stageStatuses || {}),
            trainingConfiguration: "In Progress",
          },
        };

        await this.projectService.updateAgentState(record.projectId, updatedState);
        console.info(`[ModelSelectionService] Successfully handed off ${selectedModelIds.length} user-selected models to Training Configuration for project ${record.projectId}`);

        // Update Training Job Contract schema with user-selected models
        const pWs = await this.projectService.getProjectWithWorkspace(record.projectId);
        if (pWs && pWs.project) {
          const selectedCandidates = (record.decision.candidates || []).filter((c) =>
            selectedModelIds.some((s) => s.toLowerCase().trim() === c.model_id.toLowerCase().trim())
          );
          const updatedDecision = {
            ...record.decision,
            models: selectedCandidates.map((c) => ({
              model_id: c.model_id,
              framework: c.framework || "custom",
              algorithm: c.algorithm || c.displayName || c.model_id,
              enabled: true,
              parameters: {},
            })),
          };

          const effectiveTimestamp = existingState.runTimestamp || record.datasetVersion;
          await saveModularTrainingJobContract(
            pWs.workspaceName || "DefaultWorkspace",
            pWs.project.name,
            updatedDecision,
            effectiveTimestamp
          );
          console.info(`[ModelSelectionService] Updated Training Job Contract schema with ${selectedCandidates.length} selected models for project ${record.projectId}`);
        }
      } catch (e: any) {
        console.warn(`[ModelSelectionService] Training handoff state update or contract save failed for project ${record.projectId}:`, e?.message || e);
      }
    }

    return updatedRecord || record;
  }

  public async recordUserSelectionByProject(
    projectId: string,
    selectedModelIds: string[]
  ): Promise<ModelSelectionDecisionRecord | { success: boolean; selectedModelIds: string[] }> {
    const record = await this.repository.getLatestByProjectId(projectId);
    if (record) {
      return this.recordUserSelection(record.id, selectedModelIds);
    }

    // Fallback if decision record not directly in repository but project exists in DB
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" not found`);
    }

    const existingState = (project.agentState as any) || {};
    const modelSelection = existingState.stageOutputs?.modelSelection || existingState.modelSelection || {};
    const candidates = modelSelection.candidates || [];
    const selectedCandidates = candidates.filter((c: any) =>
      selectedModelIds.some((s) => s.toLowerCase().trim() === (c.model_id || "").toLowerCase().trim())
    );

    const trainingConfigPayload = {
      ...(existingState.trainingConfiguration || {}),
      status: "Pending",
      models: selectedModelIds,
      candidate_models: selectedModelIds,
      selectedByUserAt: new Date().toISOString(),
    };

    const updatedState = {
      ...existingState,
      trainingConfiguration: trainingConfigPayload,
      stageOutputs: {
        ...(existingState.stageOutputs || {}),
        trainingConfiguration: trainingConfigPayload,
      },
      stageStatuses: {
        ...(existingState.stageStatuses || {}),
        trainingConfiguration: "Pending",
      },
    };

    await this.projectService.updateAgentState(projectId, updatedState);

    const pWs = await this.projectService.getProjectWithWorkspace(projectId);
    if (pWs && pWs.project) {
      const updatedDecision = {
        ...modelSelection,
        models: selectedCandidates.map((c: any) => ({
          model_id: c.model_id,
          framework: c.framework || "custom",
          algorithm: c.algorithm || c.displayName || c.model_id,
          enabled: true,
          parameters: {},
        })),
      };

      await saveModularTrainingJobContract(
        pWs.workspaceName || "DefaultWorkspace",
        pWs.project.name,
        updatedDecision,
        existingState.runTimestamp
      );
    }

    return { success: true, selectedModelIds };
  }
}
