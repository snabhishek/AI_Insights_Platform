import { ExecutionToolResult } from "./types";

// Allowlist the business context. Training/validation state and reports stay server-side.
const CONTEXT_FIELDS = ["projectId", "projectName", "workspaceName", "domain", "subDomain", "useCase",
  "pipelineStatus", "targetColumn", "problemType", "tables", "dataFiles", "schemaError", "currentDate"];

export function compactProjectContext(context: Record<string, any>): Record<string, any> {
  return Object.fromEntries(CONTEXT_FIELDS.filter(key => context[key] !== undefined).map(key => [key, context[key]]));
}

export function projectBusinessContext(project: any): Record<string, any> {
  const state = project.agentState ?? {};
  const feature = state.featureArchitect ?? state.stageOutputs?.featureArchitect ?? {};
  return compactProjectContext({ projectId: project.id, projectName: project.projectName || project.name,
    domain: project.domain, subDomain: project.subDomain, useCase: project.useCase, pipelineStatus: project.status,
    targetColumn: feature.targetColumn || feature.orchestrationDecision?.targetColumn || state.targetColumn || state.prediction_target_column,
    problemType: feature.problemType || feature.orchestrationDecision?.problemType || state.problemType });
}
export function compactToolResults(results: ExecutionToolResult[]): ExecutionToolResult[] {
  return results.map(result => result.toolName === "getProjectContext"
    ? { ...result, data: { success: result.success, ...compactProjectContext(result.data ?? {}) } }
    : result.toolName === "getProjectDataSchema"
      ? { ...result, data: { success: result.success, tables: result.data?.tables, dataFiles: result.data?.dataFiles } }
      : result.toolName === "getModelValidationResults"
        ? { toolName: result.toolName, success: false, error: "Legacy validation context omitted. Execute a fresh forecast for the requested dates." }
        : result);
}

export function compactMemory(memory: Record<string, unknown>): Record<string, unknown> {
  const { previousUnderstanding, previousQuery, previousAnswer, recordedAt, previousEvidence } = memory;
  return { previousUnderstanding, previousQuery, previousAnswer, recordedAt,
    previousEvidence: compactToolResults(Array.isArray(previousEvidence) ? previousEvidence : []) };
}
