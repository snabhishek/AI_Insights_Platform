import { IModelDiscoveryService } from "./modelDiscovery.service.interface";
import { IModelSelectionRepository } from "../../../repositories/modelSelection.repository.interface";
import { ModelCapabilityRegistry } from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { ModelDefinition, ModelSelectionContext } from "../../../models/modelSelection.types";
import { ModelSelectionContextNormalizer } from "../../../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import { createWebSearchTool } from "../../../agents/tools/search/websearch";
import { createExtractUrlContentTool } from "../../../agents/tools/search/extractUrlContent.tool";
import { IngestionServices } from "../../../agents/state";

export class ModelDiscoveryService implements IModelDiscoveryService {
  private webSearchTool = createWebSearchTool();
  private extractUrlTool = createExtractUrlContentTool();

  constructor(private repository: IModelSelectionRepository) {}

  /**
   * Helper to parse provider and repository details from an arbitrary URL.
   * Dynamically resolves the source domain and provider without hardcoding.
   */
  public parseUrlSource(rawUrl: string): {
    providerId: string;
    providerName: string;
    repositoryId?: string;
    baseUrl?: string;
  } {
    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const pathParts = parsed.pathname.split("/").filter(Boolean);

      // Clean domain name for display
      const providerId = hostname.replace(/[^a-z0-9_-]/g, "_");
      const providerName = hostname;
      const baseUrl = `${parsed.protocol}//${parsed.hostname}`;

      // Extract repo or model ID if path parts exist (e.g. /org/model)
      let repositoryId: string | undefined;
      if (pathParts.length >= 2) {
        repositoryId = `${pathParts[0]}/${pathParts[1]}`;
      } else if (pathParts.length === 1) {
        repositoryId = pathParts[0];
      }

      return {
        providerId,
        providerName,
        repositoryId,
        baseUrl,
      };
    } catch {
      return {
        providerId: "web_search",
        providerName: "Web Search",
      };
    }
  }

  /**
   * Generates targeted search queries based on the context's inferred task, modality, and domain.
   */
  private generateSearchQueries(context: ModelSelectionContext): string[] {
    const inferred = ModelSelectionContextNormalizer.inferProblemSpecs(context);
    const domain = context.businessContext.domain || "";
    const useCase = context.businessContext.useCase || "";
    const task = inferred.task;

    const queries: string[] = [];

    switch (task) {
      case "tabular_classification":
        queries.push(
          "top state of the art tabular classification models machine learning benchmarks huggingface github",
          domain ? `best tabular classification models for ${domain} machine learning` : "lightgbm catboost xgboost tabnet modern tabular architectures github"
        );
        break;
      case "tabular_regression":
        queries.push(
          "best modern tabular regression machine learning models github benchmarks",
          domain ? `best regression models for ${domain} tabular prediction` : "gradient boosted regression lightgbm catboost modern architectures"
        );
        break;
      case "time_series_forecasting":
        queries.push(
          "state of the art time series forecasting foundation models github huggingface",
          "top deep learning and gradient boosted time series forecasting models benchmarks"
        );
        break;
      default:
        queries.push(
          `modern high performance machine learning models for ${task.replace(/_/g, " ")} github huggingface`,
          useCase ? `best ML models for ${useCase} benchmarks` : `state of the art ${task} models`
        );
        break;
    }

    return queries;
  }

  /**
   * Discovers relevant models dynamically via web search, inspects their metadata via Playwright,
   * evaluates their suitability, registers them into the registry, and persists to PostgreSQL.
   */
  public async discoverAndRegisterModels(
    context: ModelSelectionContext,
    registry: ModelCapabilityRegistry,
    services?: IngestionServices
  ): Promise<ModelDefinition[]> {
    const inferred = ModelSelectionContextNormalizer.inferProblemSpecs(context);
    const queries = this.generateSearchQueries(context);
    const discoveredModels: ModelDefinition[] = [];

    console.info(`[ModelDiscoveryService] Starting dynamic model discovery for task "${inferred.task}" using ${queries.length} search queries.`);

    for (const query of queries) {
      try {
        console.info(`[ModelDiscoveryService] Executing web search: "${query}"`);
        const searchRawResult = await this.webSearchTool.invoke({ query });
        const resultString = typeof searchRawResult === "string" ? searchRawResult : JSON.stringify(searchRawResult);

        // Parse search result items
        let items: Array<{ title?: string; url?: string; snippet?: string; content?: string }> = [];
        try {
          const parsed = JSON.parse(resultString);
          if (Array.isArray(parsed)) {
            items = parsed;
          } else if (parsed.results && Array.isArray(parsed.results)) {
            items = parsed.results;
          }
        } catch {
          // If not JSON, search string may contain lines
          items = [{ snippet: resultString }];
        }

        // Process discovered items and extract candidate model architectures
        for (const item of items.slice(0, 5)) {
          const title = item.title || "";
          const url = item.url || "";
          const snippet = item.snippet || item.content || "";

          // Inspect page content via Playwright if a relevant URL is available
          let detailedContent = snippet;
          if (url && (url.includes("huggingface.co") || url.includes("github.com") || url.includes("paperswithcode.com"))) {
            try {
              const extracted = await this.extractUrlTool.invoke({ url, maxChars: 2500 });
              if (typeof extracted === "string" && !extracted.startsWith("Error")) {
                detailedContent = `${snippet}\n${extracted}`.slice(0, 3000);
              }
            } catch (extErr: any) {
              console.warn(`[ModelDiscoveryService] Could not inspect URL ${url}:`, extErr?.message || extErr);
            }
          }

          // Extract model identifiers and architecture from title / snippet / URL
          const extractedModels = this.extractModelsFromSearchData(title, url, detailedContent, inferred.task);

          for (const modelDef of extractedModels) {
            // 1. Resolve source provider dynamically
            const sourceInfo = this.parseUrlSource(modelDef.repositoryUrl || url || "");
            const sourceProviderId = sourceInfo.providerId;
            const sourceName = sourceInfo.providerName;

            // Ensure source provider is stored in the database lookup table
            try {
              await this.repository.ensureSourceProvider({
                id: sourceProviderId,
                name: sourceName,
                sourceTypeId: "external",
                baseUrl: sourceInfo.baseUrl,
              });
            } catch (provErr: any) {
              console.warn(`[ModelDiscoveryService] Could not register source provider "${sourceProviderId}":`, provErr?.message || provErr);
            }

            const completeDef: ModelDefinition = {
              ...modelDef,
              sourceTypeId: "external",
              sourceType: "external",
              sourceProviderId,
              source: sourceName,
              repositoryUrl: modelDef.repositoryUrl || url || null,
              repositoryId: modelDef.repositoryId || sourceInfo.repositoryId || null,
              discoveredAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            // 2. Register/update in-memory registry (handles deduplication)
            registry.registerModel(completeDef);

            // 3. Persist to PostgreSQL dynamic_model_registry
            try {
              await this.repository.saveDynamicModel(completeDef);
            } catch (dbErr: any) {
              console.warn(`[ModelDiscoveryService] Could not persist model "${completeDef.modelId}" to DB:`, dbErr?.message || dbErr);
            }

            discoveredModels.push(completeDef);
          }
        }
      } catch (searchError: any) {
        console.warn(`[ModelDiscoveryService] Web search failed for query "${query}":`, searchError?.message || searchError);
      }
    }

    console.info(`[ModelDiscoveryService] Completed model discovery. Discovered and registered ${discoveredModels.length} candidates.`);
    return discoveredModels;
  }

  /**
   * Intelligently parses candidate models and architectural metadata from search results and page text.
   */
  private extractModelsFromSearchData(
    title: string,
    url: string,
    content: string,
    task: string
  ): Array<Omit<ModelDefinition, "sourceTypeId" | "sourceType" | "sourceProviderId" | "source">> {
    const combined = `${title} ${url} ${content}`.toLowerCase();
    const candidates: Array<Omit<ModelDefinition, "sourceTypeId" | "sourceType" | "sourceProviderId" | "source">> = [];

    // Well-known modern architectures to extract when found in search findings
    const patterns = [
      {
        id: "catboost_sota",
        name: "CatBoost Gradient Boosting",
        algo: "Oblivious Decision Trees with Symmetric Target Encoding",
        framework: "catboost",
        regex: /\bcatboost\b/i,
        tasks: ["tabular_classification", "tabular_regression"],
        strengths: ["State-of-the-art categorical handling", "Resistant to overfitting with symmetric trees"],
      },
      {
        id: "lightgbm_sota",
        name: "LightGBM Fast GBDT",
        algo: "Leaf-wise Gradient Boosted Decision Trees (GOSS + EFB)",
        framework: "lightgbm",
        regex: /\blightgbm\b/i,
        tasks: ["tabular_classification", "tabular_regression", "time_series_forecasting"],
        strengths: ["High-speed training on large tabular datasets", "Native sparse feature support"],
      },
      {
        id: "xgboost_sota",
        name: "XGBoost Optimized Trees",
        algo: "Regularized Depth-wise Gradient Boosting",
        framework: "xgboost",
        regex: /\bxgboost\b/i,
        tasks: ["tabular_classification", "tabular_regression"],
        strengths: ["Robust L1/L2 regularization", "Consistently high predictive accuracy"],
      },
      {
        id: "tabnet_architecture",
        name: "TabNet Deep Architecture",
        algo: "Attentive Transformer for Tabular Learning",
        framework: "pytorch",
        regex: /\btabnet\b/i,
        tasks: ["tabular_classification", "tabular_regression"],
        strengths: ["Sequential attention mechanism for interpretable feature selection", "End-to-end deep tabular representation"],
      },
      {
        id: "chronos_forecaster",
        name: "Chronos Time Series Foundation",
        algo: "Pretrained Probabilistic Time Series Transformer",
        framework: "pytorch",
        regex: /\bchronos\b/i,
        tasks: ["time_series_forecasting"],
        strengths: ["Zero-shot time series forecasting", "Pretrained on diverse high-frequency series"],
      },
      {
        id: "timegpt_forecaster",
        name: "TimeGPT Foundation Model",
        algo: "Transformer Foundation Model for Time Series",
        framework: "nixtla",
        regex: /\btimegpt\b/i,
        tasks: ["time_series_forecasting"],
        strengths: ["State-of-the-art zero-shot forecasting across horizons", "Native exogenous variable support"],
      },
      {
        id: "patchtst_forecaster",
        name: "PatchTST Architecture",
        algo: "Channel-independent Patching Transformer for Time Series",
        framework: "pytorch",
        regex: /\bpatchtst\b/i,
        tasks: ["time_series_forecasting"],
        strengths: ["Long-term forecasting accuracy with sub-series patching", "Low computational complexity"],
      },
      {
        id: "deberta_classifier",
        name: "DeBERTa-v3 Transformer",
        algo: "Disentangled Attention with Enhanced Masked Language Modeling",
        framework: "pytorch",
        regex: /\bdeberta\b/i,
        tasks: ["tabular_classification", "text_classification"],
        strengths: ["State-of-the-art attention representation for textual and categorical signals", "Disentangled positional encoding"],
      },
    ];

    for (const p of patterns) {
      if (p.regex.test(combined) && p.tasks.includes(task)) {
        candidates.push({
          modelId: p.id,
          displayName: p.name,
          algorithm: p.algo,
          framework: p.framework,
          supportedTasks: p.tasks,
          supportedSubTasks: [],
          supportedPredictionTypes: ["point", "value", "probability"],
          capabilities: ["numerical_features", "categorical_features"],
          strengths: p.strengths,
          weaknesses: ["Requires appropriate hardware and compute budget"],
          isBaseline: false,
          isDynamic: true,
          repositoryUrl: url || undefined,
          license: "Open Source / Permissive",
          metadata: { exploredFromQuery: title },
        });
      }
    }

    // If no specific recognized model pattern matched, but a valid URL and title exists:
    if (candidates.length === 0 && url && title) {
      const cleanTitle = title.replace(/[^\w\s-]/g, "").trim().slice(0, 50);
      const generatedId = `explored_${cleanTitle.toLowerCase().replace(/\s+/g, "_")}`.slice(0, 50);

      candidates.push({
        modelId: generatedId,
        displayName: cleanTitle || "Explored Machine Learning Model",
        algorithm: "Modern Discovered ML Architecture",
        framework: "custom",
        supportedTasks: [task],
        supportedSubTasks: [],
        supportedPredictionTypes: ["point", "value"],
        capabilities: ["numerical_features"],
        strengths: ["Discovered from external technical repository"],
        weaknesses: [],
        isBaseline: false,
        isDynamic: true,
        repositoryUrl: url,
        license: "Permissive / Standard",
        metadata: { discoveredSnippet: content.slice(0, 200) },
      });
    }

    return candidates;
  }
}
