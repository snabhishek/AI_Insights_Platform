import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { agentThinking } from "../db/agentThinking";
import { IAgentThinkingRepository } from "./agentThinking.repository.interface";
import { AgentThinking, ThinkingLog } from "../models/agentThinking.types";

const SUBSTEP_ALIASES: Record<string, string[]> = {
  inspect: ["inspect", "Data Inspection", "inspection", "dataInspection"],
  "Data Inspection": ["Data Inspection", "inspect", "inspection", "dataInspection"],
  profileData: ["profileData", "Data Profiling", "dataProfile", "dataProfiling"],
  "Data Profiling": ["Data Profiling", "profileData", "dataProfile", "dataProfiling"],
  resolveSchema: ["resolveSchema", "Schema Resolver", "schemaResolution", "schemaResolver"],
  "Schema Resolver": ["Schema Resolver", "resolveSchema", "schemaResolution", "schemaResolver"],
  hierarchyMapperNode: ["hierarchyMapperNode", "Hierarchy Mapper", "hierarchyMapper", "relationshipBuilder", "formBuilder"],
  "Hierarchy Mapper": ["Hierarchy Mapper", "hierarchyMapperNode", "hierarchyMapper", "relationshipBuilder", "formBuilder"],
  hierarchyMapper: ["hierarchyMapper", "Hierarchy Mapper", "hierarchyMapperNode", "relationshipBuilder", "formBuilder"],
  relationshipBuilder: ["relationshipBuilder", "Hierarchy Mapper", "hierarchyMapperNode", "hierarchyMapper"],
  formBuilder: ["formBuilder", "Hierarchy Mapper", "hierarchyMapperNode", "hierarchyMapper"],
  featureArchitectNode: [
    "featureArchitectNode",
    "Feature Architect",
    "featureArchitect",
    "featureSupervisor",
    "featureCreation",
    "featureTransformation",
    "featureExtraction",
    "featureSelection",
    "buildDataset",
    "dataValidation",
    "programRectifier",
    "Feature Engineering",
  ],
  "Feature Architect": [
    "Feature Architect",
    "featureArchitectNode",
    "featureArchitect",
    "featureSupervisor",
    "featureCreation",
    "featureTransformation",
    "featureExtraction",
    "featureSelection",
    "buildDataset",
    "dataValidation",
    "programRectifier",
    "Feature Engineering",
  ],
  featureArchitect: ["featureArchitect", "Feature Architect", "featureArchitectNode"],
  featureSupervisor: ["featureSupervisor", "Feature Architect", "featureArchitectNode"],
  featureCreation: ["featureCreation", "Feature Architect", "featureArchitectNode"],
  featureTransformation: ["featureTransformation", "Feature Architect", "featureArchitectNode"],
  featureExtraction: ["featureExtraction", "Feature Architect", "featureArchitectNode"],
  featureSelection: ["featureSelection", "Feature Architect", "featureArchitectNode"],
  featureValidatorNode: ["featureValidatorNode", "Feature Validator", "featureValidator"],
  "Feature Validator": ["Feature Validator", "featureValidatorNode", "featureValidator"],
  featureValidator: ["featureValidator", "Feature Validator", "featureValidatorNode"],
  exogenous: ["exogenous", "Exogenous Scout", "exogenousScout"],
  "Exogenous Scout": ["Exogenous Scout", "exogenous", "exogenousScout"],
  exogenousScout: ["exogenousScout", "Exogenous Scout", "exogenous"],
  modelSelectionNode: ["modelSelectionNode", "Model Selection", "modelSelection", "finalModelSelectionNode"],
  "Model Selection": ["Model Selection", "modelSelectionNode", "modelSelection", "finalModelSelectionNode"],
  modelSelection: ["modelSelection", "Model Selection", "modelSelectionNode"],
  trainingConfigurationNode: ["trainingConfigurationNode", "Training Configuration", "trainingConfiguration", "trainingConfig"],
  "Training Configuration": ["Training Configuration", "trainingConfigurationNode", "trainingConfiguration", "trainingConfig"],
  trainingConfiguration: ["trainingConfiguration", "Training Configuration", "trainingConfigurationNode"],
  preFlightNode: ["preFlightNode", "Pre Flight", "preFlight"],
  "Pre Flight": ["Pre Flight", "preFlightNode", "preFlight"],
  preFlight: ["preFlight", "Pre Flight", "preFlightNode"],
  modelTrainingCodeNode: ["modelTrainingCodeNode", "Model Training Code Generation", "modelTrainingCode"],
  "Model Training Code Generation": ["Model Training Code Generation", "modelTrainingCodeNode", "modelTrainingCode"],
  modelTrainingCode: ["modelTrainingCode", "Model Training Code Generation", "modelTrainingCodeNode"],
  modelTrainingExecNode: ["modelTrainingExecNode", "Model Training Execution", "Model Training", "modelTrainingExec", "modelTraining", "modelTrainingNode", "modelEvaluation"],
  "Model Training Execution": ["Model Training Execution", "Model Training", "modelTrainingExecNode", "modelTrainingExec", "modelTraining", "modelTrainingNode"],
  "Model Training": ["Model Training", "Model Training Execution", "modelTrainingExecNode", "modelTrainingExec", "modelTraining", "modelTrainingNode"],
  modelTrainingExec: ["modelTrainingExec", "Model Training Execution", "Model Training", "modelTrainingExecNode"],
  modelTraining: ["modelTraining", "Model Training Execution", "Model Training", "modelTrainingExecNode"],
  modelValidationNode: ["modelValidationNode", "Model Validation", "modelValidation"],
  "Model Validation": ["Model Validation", "modelValidationNode", "modelValidation"],
  modelValidation: ["modelValidation", "Model Validation", "modelValidationNode"],
};

function getSubstepCandidates(substep: string): string[] {
  const direct = SUBSTEP_ALIASES[substep];
  if (direct && direct.length > 0) return direct;
  const lower = substep.trim().toLowerCase();
  for (const [k, v] of Object.entries(SUBSTEP_ALIASES)) {
    if (k.toLowerCase() === lower) return v;
  }
  return [substep];
}

function normalizePipeline(pipeline?: string): string | undefined {
  if (!pipeline) return undefined;
  const p = pipeline.trim().toLowerCase();
  if (p === "dataingestion" || p === "data ingestion") return "Data Ingestion";
  if (p === "featureengineering" || p === "feature engineering") return "Feature Engineering";
  if (p.includes("model") || p.includes("training") || p.includes("validation")) return "Model Training & Validation";
  return pipeline.trim();
}

export class PostgresAgentThinkingRepository implements IAgentThinkingRepository {
  constructor(private db: NodePgDatabase<any>) {}

  private mapRowToAgentThinking(row: any): AgentThinking {
    return {
      id: row.id,
      projectId: row.project_id || row.projectId,
      pipeline: row.pipeline,
      substep: row.substep,
      thinking: row.thinking || [],
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || row.createdAt),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at || row.updatedAt),
    };
  }

  async getThinking(projectId: string, pipeline: string, substep: string): Promise<AgentThinking | undefined> {
    try {
      const candidates = getSubstepCandidates(substep);
      const normalizedPipe = normalizePipeline(pipeline);

      // 1. Exact match
      let res = await this.db.select()
        .from(agentThinking)
        .where(
          and(
            eq(agentThinking.projectId, projectId),
            eq(agentThinking.pipeline, pipeline),
            eq(agentThinking.substep, substep)
          )
        );
      if (res.length > 0) return this.mapRowToAgentThinking(res[0]);

      // 2. Match candidate aliases with normalized or given pipeline
      const pipeConditions = [eq(agentThinking.projectId, projectId), inArray(agentThinking.substep, candidates)];
      if (normalizedPipe) {
        pipeConditions.push(eq(agentThinking.pipeline, normalizedPipe));
      }
      res = await this.db.select()
        .from(agentThinking)
        .where(and(...pipeConditions));
      if (res.length > 0) return this.mapRowToAgentThinking(res[0]);

      // 3. Fallback: match candidates across ANY pipeline in the same project
      res = await this.db.select()
        .from(agentThinking)
        .where(
          and(
            eq(agentThinking.projectId, projectId),
            inArray(agentThinking.substep, candidates)
          )
        );
      if (res.length > 0) return this.mapRowToAgentThinking(res[0]);

      // 4. Case-insensitive check on all records for this project
      const allProjectRows = await this.db.select()
        .from(agentThinking)
        .where(eq(agentThinking.projectId, projectId));

      const lowerCandidates = new Set(candidates.map((c) => c.toLowerCase()));
      const matchedRow = allProjectRows.find((row) =>
        lowerCandidates.has((row.substep || "").toLowerCase())
      );
      if (matchedRow) return this.mapRowToAgentThinking(matchedRow);

      return undefined;
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Error fetching thinking for project ${projectId}:`, err.message || err);
      return undefined;
    }
  }

  async getAllThinking(projectId: string, pipeline?: string): Promise<Record<string, ThinkingLog[]>> {
    try {
      const allRows = await this.db.select()
        .from(agentThinking)
        .where(eq(agentThinking.projectId, projectId));

      const map: Record<string, ThinkingLog[]> = {};

      for (const row of allRows) {
        if (!row.substep) continue;
        const rowLogs = (row.thinking as ThinkingLog[]) || [];
        map[row.substep] = rowLogs;

        // Populate aliases so both node IDs and display titles are available
        const aliases = getSubstepCandidates(row.substep);
        for (const alias of aliases) {
          if (!map[alias] || map[alias].length < rowLogs.length) {
            map[alias] = rowLogs;
          }
        }
      }

      // Aggregate sub-workers for Feature Architect
      const faWorkers = [
        "featureSupervisor",
        "featureCreation",
        "featureTransformation",
        "buildDataset",
        "dataValidation",
        "featureExtraction",
        "featureSelection",
        "programRectifier",
        "Feature Engineering",
      ];
      const aggregatedFaLogs: ThinkingLog[] = [
        ...(map["Feature Architect"] || map["featureArchitectNode"] || []),
      ];
      for (const w of faWorkers) {
        if (map[w] && Array.isArray(map[w])) {
          for (const item of map[w]) {
            if (!aggregatedFaLogs.some((l) => l.text === item.text)) {
              aggregatedFaLogs.push(item);
            }
          }
        }
      }
      if (aggregatedFaLogs.length > 0) {
        map["Feature Architect"] = aggregatedFaLogs;
        map["featureArchitectNode"] = aggregatedFaLogs;
        map["featureArchitect"] = aggregatedFaLogs;
      }

      // Aggregate sub-workers for Hierarchy Mapper
      const hmWorkers = ["relationshipBuilder", "formBuilder"];
      const aggregatedHmLogs: ThinkingLog[] = [
        ...(map["Hierarchy Mapper"] || map["hierarchyMapperNode"] || []),
      ];
      for (const w of hmWorkers) {
        if (map[w] && Array.isArray(map[w])) {
          for (const item of map[w]) {
            if (!aggregatedHmLogs.some((l) => l.text === item.text)) {
              aggregatedHmLogs.push(item);
            }
          }
        }
      }
      if (aggregatedHmLogs.length > 0) {
        map["Hierarchy Mapper"] = aggregatedHmLogs;
        map["hierarchyMapperNode"] = aggregatedHmLogs;
        map["hierarchyMapper"] = aggregatedHmLogs;
      }

      // Aggregate Model Training
      const mtWorkers = ["modelTrainingCodeNode", "modelTrainingExecNode", "modelTrainingCode", "modelTrainingExec"];
      const aggregatedMtLogs: ThinkingLog[] = [
        ...(map["Model Training"] || map["modelTrainingExecNode"] || []),
      ];
      for (const w of mtWorkers) {
        if (map[w] && Array.isArray(map[w])) {
          for (const item of map[w]) {
            if (!aggregatedMtLogs.some((l) => l.text === item.text)) {
              aggregatedMtLogs.push(item);
            }
          }
        }
      }
      if (aggregatedMtLogs.length > 0) {
        map["Model Training"] = aggregatedMtLogs;
        map["modelTrainingExecNode"] = aggregatedMtLogs;
      }

      return map;
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Error fetching all thinking for project ${projectId}:`, err.message || err);
      return {};
    }
  }

  async saveThinking(projectId: string, pipeline: string, substep: string, thinking: ThinkingLog[]): Promise<AgentThinking> {
    try {
      const canonicalPipe = normalizePipeline(pipeline) || pipeline;
      const existing = await this.getThinking(projectId, canonicalPipe, substep);
      
      if (existing) {
        const res = await this.db.update(agentThinking)
          .set({
            pipeline: canonicalPipe,
            substep,
            thinking,
            updatedAt: new Date(),
          })
          .where(eq(agentThinking.id, existing.id))
          .returning();
        return this.mapRowToAgentThinking(res[0]);
      } else {
        const id = `thinking-${uuidv4()}`;
        const res = await this.db.insert(agentThinking)
          .values({
            id,
            projectId,
            pipeline: canonicalPipe,
            substep,
            thinking,
          })
          .returning();
        return this.mapRowToAgentThinking(res[0]);
      }
    } catch (err: any) {
      console.error(`[AgentThinkingRepository] Error saving thinking for project ${projectId}:`, err.message || err);
      return {
        id: `thinking-${uuidv4()}`,
        projectId,
        pipeline,
        substep,
        thinking,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async deleteThinking(projectId: string, pipeline: string, substep: string): Promise<void> {
    try {
      const candidates = getSubstepCandidates(substep);
      await this.db.delete(agentThinking)
        .where(
          and(
            eq(agentThinking.projectId, projectId),
            inArray(agentThinking.substep, candidates)
          )
        );
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Warning: deleteThinking failed for project ${projectId}:`, err.message || err);
    }
  }

  async clearProjectPipelineThinking(projectId: string, pipeline: string): Promise<void> {
    try {
      const normalizedPipe = normalizePipeline(pipeline) || pipeline;
      const pipelineSubsteps: string[] = [];
      if (normalizedPipe === "Data Ingestion") {
        pipelineSubsteps.push(
          ...getSubstepCandidates("Data Inspection"),
          ...getSubstepCandidates("Data Profiling"),
          ...getSubstepCandidates("Schema Resolver")
        );
      } else if (normalizedPipe === "Feature Engineering") {
        pipelineSubsteps.push(
          ...getSubstepCandidates("Hierarchy Mapper"),
          ...getSubstepCandidates("Feature Architect"),
          ...getSubstepCandidates("Feature Validator"),
          ...getSubstepCandidates("Exogenous Scout")
        );
      } else if (normalizedPipe === "Model Training & Validation") {
        pipelineSubsteps.push(
          ...getSubstepCandidates("Model Selection"),
          ...getSubstepCandidates("Training Configuration"),
          ...getSubstepCandidates("Pre Flight"),
          ...getSubstepCandidates("Model Training Code Generation"),
          ...getSubstepCandidates("Model Training Execution"),
          ...getSubstepCandidates("Model Validation")
        );
      }

      if (pipelineSubsteps.length > 0) {
        await this.db.delete(agentThinking)
          .where(
            and(
              eq(agentThinking.projectId, projectId),
              inArray(agentThinking.substep, pipelineSubsteps)
            )
          );
      } else {
        await this.db.delete(agentThinking)
          .where(
            and(
              eq(agentThinking.projectId, projectId),
              eq(agentThinking.pipeline, normalizedPipe)
            )
          );
      }
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Warning: clearProjectPipelineThinking failed for project ${projectId}:`, err.message || err);
    }
  }
}
