import { IngestionServices } from "../state";
import { logMilestoneThinking, getModel, invokeAgentJson, getPromptFromFile, parseJsonObject } from "../utils/agentUtils";

function looksLikeError(stepName: string, payload: unknown): boolean {
  if (!payload) return true;
  try {
    const obj = payload as any;
    // Prefer explicit agentic retry signal when present
    // Agents may include `shouldRetry: true` or `agentDecision: "retry"` to indicate the node should be retried
    if (typeof obj?.shouldRetry === "boolean") {
      return obj.shouldRetry === true;
    }
    if (typeof obj?.agentDecision === "string") {
      const dec = obj.agentDecision.trim().toLowerCase();
      if (dec === "retry" || dec === "re-run" || dec === "rerun") return true;
      if (dec === "accept" || dec === "ok" || dec === "done") return false;
    }

    // Normalize status (fallback if agent did not provide explicit decision)
    const statusRaw = typeof obj?.status === "string" ? obj.status.trim().toLowerCase() : "";

    // Define expected keys per node based on prompt output schemas
    const expectedMap: Record<string, string[]> = {
      featureCreation: ["status", "summary", "recommendations", "pythonCode", "yamlLineage"],
      featureTransformation: ["status", "summary", "recommendations", "pythonCode", "yamlLineage"],
      featureExtraction: ["status", "summary", "recommendations", "pythonCode", "yamlLineage"],
      featureSelection: ["status", "summary", "recommendations", "pythonCode", "yamlLineage"],
      buildDataset: ["status", "summary", "pythonCode", "yamlLineage"],
      dataValidation: ["status", "summary", "pythonCode", "yamlLineage"],
      programRectifier: ["status", "rectifiedCode", "explanation"],
      profileData: ["status", "tables", "tableOrder"],
      profiledata: ["status", "tables", "tableOrder"],
    };

    const expected = expectedMap[stepName] || expectedMap[stepName.toLowerCase()] || [];

    // If status explicitly OK-like, ensure presence of key outputs
    const okStates = ["ok", "success", "completed", "done"];
    if (okStates.includes(statusRaw)) {
      for (const key of expected) {
        if (!(key in obj)) {
          return true; // missing required key
        }
        // additional non-empty checks for arrays/strings
        const val = obj[key];
        if (val === null || val === undefined) return true;
        if (Array.isArray(val) && val.length === 0) return true;
        if (typeof val === "string" && val.trim().length === 0) return true;
      }
      return false; // looks good
    }
    // If status is in-progress/pending/running, require that some progress artifact exists
    if (["in-progress", "pending", "running"].includes(statusRaw)) {
      // require at least one meaningful artifact depending on node
      if (expected.includes("pythonCode") && typeof obj?.pythonCode === "string" && obj.pythonCode.trim().length > 0) {
        // Agent produced code but marked in-progress: consider incomplete (retry)
        return true;
      }
      if (expected.includes("tables") && Array.isArray(obj?.tables) && obj.tables.length > 0) {
        // For profiling, if tables present but status is in-progress, check that each table has profiling fields
        const tables: any[] = obj.tables;
        for (const t of tables) {
          if (!t.tableName || !t.contentProfile) return true;
          if (!Array.isArray(t.contentProfile.columns) || t.contentProfile.columns.length === 0) return true;
        }
        // If profiling appears complete despite in-progress flag, accept it
        return false;
      }

      // default: treat in-progress as needing retry
      return true;
    }

    // Otherwise, be conservative: if status is not explicitly OK-like, treat as retry
    if (!okStates.includes(statusRaw)) return true;

    return false;
  } catch (e) {
    return true;
  }
}

export async function validateWithRetry<T extends Record<string, unknown>>(
  stepName: string,
  invokeFn: () => Promise<T>,
  fallback: T,
  services?: IngestionServices,
  maxRetries = 3
): Promise<T> {
  let attempt = 0;
  const model = getModel();
  const evaluatorPrompt = 
    `You are an assistant validator.
Given the agent output JSON (below) and the expected keys for the node, decide whether the agent should retry the same node or accept the output.
Return a single JSON object with the shape: { "shouldRetry": true|false, "reason": "short explanation" }.
Do not return any other text.`
  while (attempt < maxRetries) {
    attempt += 1;
    if (services) {
      await logMilestoneThinking(services, "Validation", `Validator running for ${stepName} (attempt ${attempt}/${maxRetries})`);
    }

    try {
      const result = await invokeFn();
      // If we have an LLM model, ask it whether this result should be retried (agentic validation)
      if (model && services) {
        try {
          const userMessage = [
            `Step: ${stepName}`,
            `Agent output: ${JSON.stringify(result, null, 2)}`,
            `Expected keys: ${JSON.stringify(Object.keys(({} as any)), null, 2)}`,
            "Return: JSON {\"shouldRetry\": true|false, \"reason\": \"...\"} only."
          ].join("\n\n");

          const agentEval = await invokeAgentJson(
            "validator",
            model,
            `${evaluatorPrompt}\n\n${userMessage}`,
            { shouldRetry: true, reason: "fallback due to parse failure" } as any,
            services,
            { traceLabel: `validator:${stepName}`, recursionLimit: 10 }
          );

          const parsed = parseJsonObject(JSON.stringify(agentEval), { shouldRetry: true } as any);
          if (parsed && typeof (parsed as any).shouldRetry === "boolean") {
            if (!(parsed as any).shouldRetry) {
              return result; // agent says accept
            }
            // else agent says retry -> continue loop
            await logMilestoneThinking(services, "Validation", `Agent requested retry for ${stepName}: ${(parsed as any).reason || "no reason"}`);
            // fallthrough to retry
          }
        } catch (err) {
          // if agent evaluation fails, fall back to structural checks below
          console.warn("Validator agent evaluation failed, falling back to structural checks", err);
        }
      }

      // Structural fallback: if looksLikeError says it's OK, accept
      if (!looksLikeError(stepName, result)) {
        return result;
      }

      if (services) {
        await logMilestoneThinking(
          services,
          "Validation",
          `Validator detected problems in ${stepName} output (attempt ${attempt}/${maxRetries}).`
        );
      }
    } catch (err) {
      if (services) {
        await logMilestoneThinking(
          services,
          "Validation",
          `Validator caught exception in ${stepName} (attempt ${attempt}/${maxRetries}): ${String(err)}`
        );
      }
    }
  }

  if (services) {
    await logMilestoneThinking(services, "Validation", `Validator giving up on ${stepName} after ${maxRetries} attempts. Returning fallback.`);
  }
  return fallback;
}

export default validateWithRetry;
