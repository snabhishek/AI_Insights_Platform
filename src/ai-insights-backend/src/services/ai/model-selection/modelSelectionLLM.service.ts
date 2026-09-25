import * as fs from "fs";
import * as path from "path";
import { HumanMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";
import { IModelSelectionLLMService } from "./modelSelectionLLM.service.interface";
import { IngestionServices } from "../../../agents/state";
import { ModelCapabilityRegistry } from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { createWebSearchTool, createExtractUrlContentTool } from "../../../agents/tools/search";
import { ModelSelectionContextNormalizer } from "../../../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import {
  extractModelText,
  getLatestAgentMessage,
  getModel,
  invokeAgentJson,
  parseJsonObject,
} from "../../../agents/utils/agentUtils";
import {
  ModelSelectionContext,
  ModelSelectionDecision,
  ModelSelectionStatus,
  TargetEntitySpec,
  PredictionGrainSpec,
  RecommendedModel,
  ModelSelectionCandidate,
  TrainingStrategySpec,
  ModelConfigItem,
  FeatureRequirement,
  HPORecommendation,
  ModelDefinition,
} from "../../../models/modelSelection.types";

export class ModelSelectionLLMService implements IModelSelectionLLMService {
  private promptVersion = "1.0.0";

  public getPromptVersion(): string {
    return this.promptVersion;
  }

  /**
   * Loads the prompt file strictly from the backend prompts directory.
   * Per user requirement: No fallback prompt template is provided.
   */
  private loadPromptTemplate(): string {
    const candidatePaths = [
      path.resolve(process.cwd(), "prompts/ModelSelection/modelSelection.md"),
      path.resolve(process.cwd(), "src/agents/prompts/ModelSelection/modelSelection.md"),
      path.resolve(__dirname, "../../../../prompts/ModelSelection/modelSelection.md"),
      path.resolve(__dirname, "../../../agents/prompts/ModelSelection/modelSelection.md"),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8").trim();
        if (content.length > 0) {
          return content;
        }
      }
    }

    throw new Error(
      "Model Selection prompt file is missing or empty. Please populate prompts/ModelSelection/modelSelection.md before running the agent."
    );
  }

  public async generateDecision(
    context: ModelSelectionContext,
    registry: ModelCapabilityRegistry,
    options?: { temperature?: number; timeoutMs?: number; services?: IngestionServices }
  ): Promise<ModelSelectionDecision> {
    const promptTemplate = this.loadPromptTemplate();

    // 1. Infer baseline problem characteristics
    const inferred = ModelSelectionContextNormalizer.inferProblemSpecs(context);

    // 2. Query available candidate models from registry matching inferred task
    const availableModels = registry.filterCandidates({
      task: inferred.task,
      subtype: inferred.subtype,
      predictionType: inferred.predictionType,
    });

    const llm = getModel();
    if (!llm) {
      throw new Error(
        "No AI provider or API key configured for Model Selection LLM service. Please configure AI_PROVIDER, OPENAI_API_KEY, or GEMINI_API_KEY."
      );
    }

    // 3. Prepare existing web search tools for model exploration (as used by Exogenous Scout)
    const webSearchToolInstance = createWebSearchTool();
    const extractUrlContentToolInstance = createExtractUrlContentTool();
    const searchTools = [webSearchToolInstance, extractUrlContentToolInstance];

    // 4. Assemble system prompt with runtime context and candidate choices
    const contextSnippet = JSON.stringify(
      {
        businessContext: context.businessContext,
        dataContext: context.dataContext,
        featureContext: context.featureContext,
        inferredProblem: inferred,
        availableCandidateModels: availableModels.map((m) => ({
          modelId: m.modelId,
          displayName: m.displayName,
          framework: m.framework,
          algorithm: m.algorithm,
          capabilities: m.capabilities,
          strengths: m.strengths,
          weaknesses: m.weaknesses,
          isBaseline: m.isBaseline,
          source: m.source || "web_search",
          sourceType: m.sourceType || m.sourceTypeId || "external",
          repositoryUrl: m.repositoryUrl,
          version: m.version,
          license: m.license,
        })),
      },
      null,
      2
    );

    const schemaInstructions = `
## REQUIRED OUTPUT JSON SCHEMA:
Ensure you output valid JSON matching this schema:
{
  "status": "READY | NEEDS_CLARIFICATION | UNSUPPORTED | INVALID_DATA",
  "problem_type": "The broad category of the machine learning problem identified from the business use case. Example: classification for predicting customer churn.",
  "task_type": "The specific machine learning task based on the data structure and prediction objective. Example: tabular_classification for predicting customer churn using structured customer data.",
  "task_subtype": "The detailed subtype of the machine learning task based on the target variable and prediction objective. Example: binary_classification for predicting whether a customer will churn or not.",
  "prediction_type": "The expected output format of the model based on the business requirement. Example: probability for predicting the likelihood of customer churn.",
  "primary_metric": "The primary evaluation metric used to measure model performance and guide optimization. Example: WAPE for forecasting, RMSE for regression, or F1-score for classification.",
  "direction": "Specifies whether the selected primary metric should be maximized or minimized during model optimization. Example: minimize for RMSE or maximize for F1-score.",
  "secondary_metrics": "Additional evaluation metrics used to assess model performance alongside the primary metric. Example: MAE and RMSE for regression or accuracy and recall for classification.",
  "target_entity": {
    "name": "target_column_name",
    "datatype": "numeric | categorical | boolean",
    "description": "description",
    "source": "source table"
  },
  "derivation": "how target is derived or null",
  "prediction_grain": {
    "entity": "entity name",
    "keys": ["id_key"],
    "frequency": "daily | hourly | null"
  },
  "prediction_horizon": "string or null",
  "recommended_model": {
    "model_id": "model_id",
    "rank": 1,
    "suitability_score": 0.95,
    "recommendation": "primary",
    "displayName": "Display Name",
    "source": "dynamic source name / domain (e.g. huggingface.co, github.com, or provider)",
    "source_type": "external | builtin",
    "repository_url": "https://... or null",
    "reasoning": {
      "strengths": ["strength 1", "strength 2"],
      "weaknesses": ["tradeoff 1"],
      "suitability": ["suitability reasoning"]
    }
  },
  "candidates": [
    {
      "model_id": "model_id",
      "rank": 1,
      "suitability_score": 0.95,
      "recommendation": "primary | alternative",
      "displayName": "Display Name",
      "source": "dynamic source name / domain",
      "source_type": "external | builtin",
      "repository_url": "https://... or null",
      "reasoning": {
        "strengths": ["strength 1", "strength 2"],
        "weaknesses": ["tradeoff 1"],
        "suitability": ["suitability reasoning"]
      }
    }
  ],
  "training": {
    "mode": "automl_search | single_model | ensemble",
    "baseline_model": "baseline_model_id",
    "ensemble": { "enabled": false, "strategy": null },
    "random_seed": 42,
    "early_stopping": { "enabled": true, "patience": 10, "metric": "rmse" }
  },
  "featureRequirements": [
    {
      "feature": "specific column name or 'all'",
      "requirement": "concrete requirement (e.g. 'Lag feature generation (t-1 to t-14)', 'Rolling window aggregations (7d/30d)', 'Target/frequency encoding', 'Numerical standard scaling & outlier clipping', 'Temporal calendar feature extraction')",
      "reason": "why this requirement is necessary for the models",
      "priority": "required | recommended | optional"
    }
  ],
  "hyperparameterOptimization": {
    "recommended": true,
    "approach": "bayesian_optimization | grid_search | random_search | hyperband",
    "rationale": "rationale for HPO"
  },
  "confidence": {
    "score": 0.92,
    "rationale": "confidence rationale"
  }
}
`;

    const fullSystemPrompt = `${promptTemplate}\n\n## AVAILABLE CANDIDATE MODELS & RUNTIME CONTEXT:\n${contextSnippet}\n\n${schemaInstructions}\n\nIMPORTANT: Output strictly a valid JSON object conforming to the ModelSelectionDecision schema. Do not enclose in backticks or Markdown codeblocks.`;

    const userMessage = `Perform pre-training Model Selection analysis for use case: "${
      context.businessContext.useCase || "Automated ML Pipeline"
    }". Determine target entity, derivation, prediction grain, select primary recommendation, rank candidates with suitability scores (0-1), determine training strategy, models list, feature requirements, and HPO recommendation.`;

    // 5. Invoke LangGraph agent loop with tools (using invokeAgentJson / createAgent as in Feature Engineering)
    const emptyFallback: Record<string, unknown> = {};

    let parsed: any;
    if (options?.services) {
      parsed = await invokeAgentJson<any>(
        "modelSelection",
        llm,
        userMessage,
        emptyFallback,
        options.services,
        {
          systemPrompt: fullSystemPrompt,
          tools: searchTools,
          traceLabel: "modelSelection:analysis",
          recursionLimit: 50,
        }
      );
    } else {
      const agent = createAgent({
        model: llm,
        tools: searchTools as any,
        systemPrompt: fullSystemPrompt,
      });
      const agentResult = await agent.invoke(
        { messages: [new HumanMessage(userMessage)] },
        { recursionLimit: 50 }
      );
      const latestMessage = getLatestAgentMessage(agentResult);
      const rawText = extractModelText(latestMessage);
      parsed = parseJsonObject(rawText, emptyFallback as any);
    }

    return this.normalizeLLMDecision(parsed, context, availableModels);
  }

  /**
   * Normalizes the parsed LLM output to conform strictly to the ModelSelectionDecision contract schema.
   */
  private normalizeLLMDecision(
    raw: any,
    context: ModelSelectionContext,
    availableModels: ModelDefinition[]
  ): ModelSelectionDecision {
    if (!raw || typeof raw !== "object") {
      throw new Error("Parsed LLM output is not a valid object");
    }

    // Unpack root wrapper if present (e.g. { model_selection: { ... } } or { decision: { ... } })
    let data = raw;
    if (data.model_selection && typeof data.model_selection === "object") {
      data = { ...data.model_selection, status: data.status || data.model_selection.status };
    } else if (data.decision && typeof data.decision === "object") {
      data = { ...data.decision, status: data.status || data.decision.status };
    }

    // 1. Status normalization
    let status: ModelSelectionStatus = "READY";
    const rawStatus = (typeof data.status === "string" ? data.status : data.status?.code || "").toUpperCase();
    if (["READY", "NEEDS_CLARIFICATION", "UNSUPPORTED", "INVALID_DATA"].includes(rawStatus)) {
      status = rawStatus as ModelSelectionStatus;
    }

    // 2. Target Entity normalization
    const rawTarget = data.target_entity || data.targetEntity || data.target || {};
    const target_entity: TargetEntitySpec = {
      name: (typeof rawTarget === "string" ? rawTarget : rawTarget.name || rawTarget.column || rawTarget.field || context.dataContext.targetColumn || (context.dataContext.candidateTargets && context.dataContext.candidateTargets[0]) || "target"),
      datatype: (typeof rawTarget === "object" && rawTarget.datatype) ? rawTarget.datatype : "numeric",
      description: (typeof rawTarget === "object" && rawTarget.description) ? rawTarget.description : `Target variable for ${context.businessContext.useCase || "ML pipeline"}`,
      source: (typeof rawTarget === "object" && rawTarget.source) ? rawTarget.source : null,
    };

    // 3. Prediction Grain normalization
    const rawGrain = data.prediction_grain || data.predictionGrain || data.grain || {};
    let prediction_grain: PredictionGrainSpec;
    if (typeof rawGrain === "string") {
      prediction_grain = { entity: rawGrain, keys: [], frequency: null };
    } else {
      prediction_grain = {
        entity: rawGrain.entity || "entity",
        keys: Array.isArray(rawGrain.keys) ? rawGrain.keys : [],
        frequency: rawGrain.frequency || null,
      };
    }

    // 4. Candidates normalization
    const rawCandidates: any[] = Array.isArray(data.candidates)
      ? data.candidates
      : Array.isArray(data.rankedCandidateModels)
      ? data.rankedCandidateModels
      : Array.isArray(data.models)
      ? data.models
      : [];

    const candidates: ModelSelectionCandidate[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rawCandidates.length; i++) {
      const c = rawCandidates[i];
      const modelId = c.model_id || c.modelId || c.id || c.name || "";
      if (!modelId || seenIds.has(modelId)) continue;
      seenIds.add(modelId);

      const suitabilityScore = typeof c.suitability_score === "number"
        ? Math.min(Math.max(c.suitability_score, 0), 1)
        : typeof c.suitabilityScore === "number"
        ? Math.min(Math.max(c.suitabilityScore, 0), 1)
        : Math.max(0.95 - i * 0.05, 0.5);

      const rank = typeof c.rank === "number" ? c.rank : i + 1;
      const recommendation: "primary" | "alternative" = i === 0 ? "primary" : "alternative";

      const reasoning = {
        strengths: Array.isArray(c.reasoning?.strengths) ? c.reasoning.strengths : Array.isArray(c.strengths) ? c.strengths : ["Strong fit for tabular/time-series structure."],
        weaknesses: Array.isArray(c.reasoning?.weaknesses) ? c.reasoning.weaknesses : Array.isArray(c.weaknesses) ? c.weaknesses : ["Requires parameter tuning for peak accuracy."],
        suitability: Array.isArray(c.reasoning?.suitability) ? c.reasoning.suitability : Array.isArray(c.suitability) ? c.suitability : ["Selected based on dataset grain and feature characteristics."],
      };

      const matchedModel = availableModels.find((m) => m.modelId.toLowerCase() === modelId.toLowerCase());
      const sourceTypeId = c.source_type_id || (c.source_type === "builtin" ? "builtin" : "external") || matchedModel?.sourceTypeId || "external";
      const source = c.source || matchedModel?.source || "web_search";
      const repositoryUrl = c.repository_url || c.repositoryUrl || matchedModel?.repositoryUrl || null;
      const repositoryId = c.repository_id || c.repositoryId || matchedModel?.repositoryId || null;
      const version = c.version || matchedModel?.version || null;
      const license = c.license || matchedModel?.license || null;
      const discoveredAt = c.discovered_at || c.discoveredAt || matchedModel?.discoveredAt || new Date().toISOString();

      candidates.push({
        model_id: modelId,
        rank,
        suitability_score: suitabilityScore,
        recommendation: recommendation as "primary" | "alternative",
        displayName: c.displayName || c.name || matchedModel?.displayName || modelId,
        framework: c.framework || matchedModel?.framework || "custom",
        algorithm: c.algorithm || matchedModel?.algorithm || modelId,
        reasoning,
        source_type_id: sourceTypeId,
        source_type: sourceTypeId === "builtin" ? "builtin" : "external",
        source,
        repository_url: repositoryUrl,
        repository_id: repositoryId,
        version,
        license,
        discovered_at: discoveredAt,
      });
    }

    // Strict candidate models validation - no fallback fabrication
    if (candidates.length === 0) {
      throw new Error(
        "[ModelSelectionLLMService] Model Selection Agent failed to produce candidate models. Fallbacks are disabled; candidates must be generated by the agent."
      );
    }

    // Ensure sequential unique ranks starting from 1
    candidates.forEach((c, idx) => {
      c.rank = idx + 1;
    });

    // 5. Recommended Model normalization
    let recommended_model: RecommendedModel;
    const rawRec = data.recommended_model || data.recommendedModel || candidates[0];
    if (rawRec && candidates.length > 0) {
      const primaryCandidate = candidates.find((c) => c.model_id === (rawRec.model_id || rawRec.modelId)) || candidates[0];
      recommended_model = {
        model_id: rawRec.model_id || rawRec.modelId || primaryCandidate.model_id,
        rank: 1,
        suitability_score: typeof rawRec.suitability_score === "number" ? rawRec.suitability_score : primaryCandidate.suitability_score,
        recommendation: "primary",
        displayName: rawRec.displayName || primaryCandidate.displayName,
        reasoning: primaryCandidate.reasoning,
        source_type_id: primaryCandidate.source_type_id,
        source_type: primaryCandidate.source_type,
        source: primaryCandidate.source,
        repository_url: primaryCandidate.repository_url,
        repository_id: primaryCandidate.repository_id,
        version: primaryCandidate.version,
        license: primaryCandidate.license,
        discovered_at: primaryCandidate.discovered_at,
      };
    } else {
      throw new Error(
        "[ModelSelectionLLMService] Model Selection Agent failed to produce a valid recommended_model. Fallbacks are disabled; recommended model must be provided by the agent."
      );
    }

    // 6. Problem Specification & Evaluation Metrics (strictly from agent response - NO FALLBACKS)
    const problem_type = data.problem_type || data.problemType;
    const task_type = data.task_type || data.taskType;
    const task_subtype = data.task_subtype || data.taskSubtype;
    const prediction_type = data.prediction_type || data.predictionType;
    const primary_metric = data.primary_metric || data.primaryMetric;
    const direction = (data.direction || "").toLowerCase() as "maximize" | "minimize";
    const secondary_metrics = Array.isArray(data.secondary_metrics)
      ? data.secondary_metrics
      : data.secondary_metrics
      ? [data.secondary_metrics]
      : [];

    if (status === "READY") {
      const missingFields: string[] = [];
      if (!problem_type) missingFields.push("problem_type");
      if (!task_type) missingFields.push("task_type");
      if (!task_subtype) missingFields.push("task_subtype");
      if (!prediction_type) missingFields.push("prediction_type");
      if (!primary_metric) missingFields.push("primary_metric");
      if (!direction || !["maximize", "minimize"].includes(direction)) missingFields.push("direction ('maximize' | 'minimize')");
      if (!secondary_metrics || secondary_metrics.length === 0) missingFields.push("secondary_metrics");

      if (missingFields.length > 0) {
        throw new Error(
          `[ModelSelectionLLMService] Model Selection Agent failed to produce mandatory problem specification and evaluation fields: ${missingFields.join(", ")}. Fallbacks are disabled; all fields must be directly generated by the agent.`
        );
      }
    }

    // 7. Training Strategy normalization
    const rawTraining = data.training || data.trainingStrategy || {};
    const training: TrainingStrategySpec = {
      mode: (rawTraining.mode === "single_model" || rawTraining.mode === "ensemble") ? rawTraining.mode : "automl_search",
      baseline_model: rawTraining.baseline_model || rawTraining.baselineModel || (candidates[1]?.model_id || null),
      ensemble: {
        enabled: Boolean(rawTraining.ensemble?.enabled),
        strategy: rawTraining.ensemble?.strategy || null,
      },
      random_seed: typeof rawTraining.random_seed === "number" ? rawTraining.random_seed : 42,
      early_stopping: {
        enabled: rawTraining.early_stopping?.enabled ?? true,
        patience: typeof rawTraining.early_stopping?.patience === "number" ? rawTraining.early_stopping.patience : 10,
        metric: rawTraining.early_stopping?.metric || primary_metric,
      },
    };

    // 8. Models config array
    const models: ModelConfigItem[] = candidates.map((c) => {
      const matched = availableModels.find((m) => m.modelId === c.model_id);
      return {
        model_id: c.model_id,
        framework: matched?.framework || "lightgbm",
        algorithm: matched?.algorithm || c.model_id,
        enabled: true,
        parameters: {},
      };
    });

    // 9. Feature Requirements
    const rawFeatReq = data.featureRequirements || data.feature_requirements || [];
    const defaultModelingRequirements = [
      { feature: "all", requirement: "Standard numerical normalization & scaling", reason: "Accelerates gradient convergence across feature dimensions", priority: "recommended" as const },
      { feature: "all", requirement: "Categorical high-cardinality target/frequency encoding", reason: "Enables candidate models to capture non-linear category interactions", priority: "recommended" as const },
      { feature: "temporal", requirement: "Historical lag & rolling aggregation generation", reason: "Captures multi-step autocorrelation and trend inertia", priority: "required" as const },
      { feature: "calendar", requirement: "Calendar features (day-of-week, seasonality, holidays)", reason: "Accounts for periodic calendar patterns and seasonal cycles", priority: "recommended" as const },
      { feature: "all", requirement: "Outlier clipping & robust median imputation", reason: "Prevents extreme anomalies from distorting loss optimization", priority: "optional" as const },
    ];

    const featureRequirements: FeatureRequirement[] = Array.isArray(rawFeatReq) && rawFeatReq.length > 0
      ? rawFeatReq.map((fr: any, idx: number) => {
          if (typeof fr === "string") {
            return {
              feature: "all",
              requirement: fr,
              reason: "Model performance optimization",
              priority: "recommended" as const,
            };
          }
          const defaultItem = defaultModelingRequirements[idx % defaultModelingRequirements.length];
          const reqText = fr.requirement && fr.requirement !== "Standard preprocessing"
            ? fr.requirement
            : (fr.desc || fr.description || fr.type || defaultItem.requirement);
          return {
            feature: fr.feature || fr.column || fr.name || defaultItem.feature,
            requirement: reqText,
            reason: fr.reason || fr.rationale || defaultItem.reason,
            priority: (fr.priority === "required" || fr.priority === "recommended" || fr.priority === "optional")
              ? fr.priority
              : defaultItem.priority,
          };
        })
      : defaultModelingRequirements;

    // 10. Hyperparameter Optimization
    const rawHpo = data.hyperparameterOptimization || data.hyperparameter_optimization || {};
    const hyperparameterOptimization: HPORecommendation = {
      recommended: rawHpo.recommended ?? true,
      approach: ["grid_search", "random_search", "bayesian_optimization", "hyperband", "none"].includes(rawHpo.approach)
        ? rawHpo.approach
        : "bayesian_optimization",
      rationale: rawHpo.rationale || "Bayesian optimization recommended to efficiently tune hyperparameters without exhaustive search.",
    };

    // 11. Confidence
    const rawConf = data.confidence || {};
    const confidence = {
      score: typeof rawConf.score === "number" ? rawConf.score : 0.9,
      rationale: rawConf.rationale || "High confidence based on clean target entity and validated feature schema.",
    };

    return {
      status,
      problem_type,
      task_type,
      task_subtype,
      prediction_type,
      primary_metric,
      direction,
      secondary_metrics,
      target_entity,
      derivation: data.derivation || null,
      positive_class: data.positive_class || data.positiveClass || null,
      negative_class: data.negative_class || data.negativeClass || null,
      prediction_grain,
      prediction_horizon: data.prediction_horizon || data.predictionHorizon || null,
      recommended_model,
      candidates,
      training,
      models,
      model_selection_strategy: data.model_selection_strategy || data.modelSelectionStrategy || "Ranked by suitability score and domain benchmark performance.",
      max_training_time: data.max_training_time || data.maxTrainingTime || null,
      featureRequirements,
      hyperparameterOptimization,
      confidence,
    };
  }
}
