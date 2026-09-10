import * as fs from "fs";
import * as path from "path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { IModelSelectionLLMService } from "./modelSelectionLLM.service.interface";
import { ModelCapabilityRegistry } from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { createModelWebSearchTool } from "../../../agents/ModelTrainingValidation/ModelSelection/modelWebSearch.tool";
import { ModelSelectionContextNormalizer } from "../../../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import { getModel } from "../../../agents/utils/agentUtils";
import {
  ModelSelectionContext,
  ModelSelectionDecision,
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
    _options?: { temperature?: number; timeoutMs?: number }
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

    // 3. Bind web search tool for model exploration
    const searchTool = createModelWebSearchTool(registry);
    const modelWithTools = (llm as any).bindTools
      ? (llm as any).bindTools([searchTool])
      : llm;

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
        })),
      },
      null,
      2
    );

    const fullSystemPrompt = `${promptTemplate}\n\n## AVAILABLE CANDIDATE MODELS & RUNTIME CONTEXT:\n${contextSnippet}\n\nIMPORTANT: Output strictly a valid JSON object conforming to the ModelSelectionDecision schema. Do not enclose in backticks or Markdown codeblocks.`;

    const userMessage = `Perform pre-training Model Selection analysis for use case: "${
      context.businessContext.useCase || "Automated ML Pipeline"
    }". Determine target entity, derivation, prediction grain, select primary recommendation, rank candidates with suitability scores (0-1), determine training strategy, models list, feature requirements, and HPO recommendation.`;

    // 5. Invoke LLM
    const response = await modelWithTools.invoke([
      new SystemMessage(fullSystemPrompt),
      new HumanMessage(userMessage),
    ]);

    let responseText = typeof response?.content === "string" ? response.content : JSON.stringify(response?.content || "");

    // 6. Strip Markdown fences if present
    responseText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();

    try {
      const parsed: ModelSelectionDecision = JSON.parse(responseText);
      return parsed;
    } catch (parseError: any) {
      console.error("[ModelSelectionLLMService] Failed to parse LLM response JSON:", responseText);
      throw new Error(`LLM output could not be parsed as valid JSON: ${parseError?.message || parseError}`);
    }
  }
}
