import { IngestionServices } from "../state";
import { logMilestoneThinking, getModel, invokeAgentJson, parseJsonObject } from "../utils/agentUtils";

const expectedMap: Record<string, string[]> = {
  featureCreation: ["status", "summary", "pythonCode"],
  featureTransformation: ["status", "summary", "pythonCode"],
  featureExtraction: ["status", "summary", "pythonCode"],
  featureSelection: ["status", "summary", "pythonCode"],
  featureValidator: ["status", "summary", "validatedFeatureSet"],
  buildDataset: ["status", "summary", "pythonCode"],
  dataValidation: ["status", "summary", "pythonCode"],
  programRectifier: ["status", "rectifiedCode", "explanation"],
  profileData: ["status", "tables"],
  profiledata: ["status", "tables"],
  trainingConfiguration: ["status", "summary", "configuration"],
  trainingConfigurationNode: ["status", "summary", "configuration"],
};

export function looksLikeError(stepName: string, payload: unknown): boolean {
  if (!payload) return true;
  try {
    const obj = payload as any;

    if (typeof obj?.shouldRetry === "boolean") {
      return obj.shouldRetry === true;
    }
    if (typeof obj?.agentDecision === "string") {
      const dec = obj.agentDecision.trim().toLowerCase();
      if (dec === "retry" || dec === "re-run" || dec === "rerun") return true;
      if (dec === "accept" || dec === "ok" || dec === "done" || dec === "completed") return false;
    }

    const statusRaw = typeof obj?.status === "string" ? obj.status.trim().toLowerCase() : "";
    const expected = expectedMap[stepName] || expectedMap[stepName.toLowerCase()] || ["status"];

    const validStates = ["ok", "success", "completed", "done", "running", "in-progress", "pending"];
    if (validStates.includes(statusRaw)) {
      for (const key of expected) {
        if (!(key in obj)) {
          return true;
        }
        const val = obj[key];
        if (val === null || val === undefined) return true;
        if (typeof val === "string" && val.trim().length === 0 && key !== "explanation") return true;
      }
      return false;
    }

    if (statusRaw === "failed" || statusRaw === "error") {
      return true;
    }

    // If core keys exist even without an explicit status match, accept it
    const hasCoreKeys = expected.every((key) => key in obj && obj[key] !== null && obj[key] !== undefined);
    return !hasCoreKeys;
  } catch (e) {
    return true;
  }
}

type CustomValidatorResult = { isValid: boolean; errors?: string[]; reason?: string }

export async function validateWithRetry<T extends Record<string, unknown>>(
  stepName: string,
  invokeFn: (feedbackPrompt?: string) => Promise<T>,
  fallback: T,
  services?: IngestionServices,
  maxRetries = 1,
  validatorPrompt?: string,
  customValidator?: (output: T) => CustomValidatorResult
): Promise<T> {
  let attempt = 0;
  let lastFeedback: string | undefined = undefined;
  const model = getModel();
  const defaultEvaluatorPrompt =
    `You are an assistant validator.
Given the agent output JSON (below) and the expected keys for the node, decide whether the agent should retry the same node or accept the output.
Return a single JSON object with the shape: { "shouldRetry": true|false, "reason": "short explanation" }.
Do not return any other text.`;

  const evaluatorPrompt = validatorPrompt && validatorPrompt.trim().length > 0
    ? `${defaultEvaluatorPrompt}\n\nSpecific Validation Criteria:\n${validatorPrompt.trim()}`
    : defaultEvaluatorPrompt;

  while (attempt <= maxRetries) {
    attempt += 1;

    try {
      const result = await invokeFn(lastFeedback);

      // 1. If custom deterministic validator is supplied, check it first
      if (typeof customValidator === "function") {
        const check = customValidator(result);
        if (check.isValid) {
          return result; // Shows green immediately
        }

        const errorsJoined = Array.isArray(check.errors) && check.errors.length > 0
          ? check.errors.join("; ")
          : (check.reason || "Validation criteria not satisfied");

        lastFeedback = `Previous attempt had validation errors: ${errorsJoined}. Please rectify these issues in your output.`;
        if (services) {
          await logMilestoneThinking(services, "Validation", `Validator identified issues in ${stepName} (attempt ${attempt}/${maxRetries + 1}): ${errorsJoined}`);
        }

        if (attempt > maxRetries) {
          return result;
        }
        continue;
      }

      // 2. Structural validation first — if valid, accept immediately
      // if (!looksLikeError(stepName, result)) {
      //   return result;
      // }

      // 3. If structural checks flagged potential issue and model is available, consult validator agent
      if (model && services && attempt <= maxRetries) {
        try {
          const expected = expectedMap[stepName] || expectedMap[stepName.toLowerCase()] || [];
          const userMessage = [
            `Step: ${stepName}`,
            `Agent output: ${JSON.stringify(result, null, 2)}`,
            `Expected keys: ${JSON.stringify(expected, null, 2)}`,
            validatorPrompt ? `Validation Rules: ${validatorPrompt}` : "",
            "Return: JSON {\"shouldRetry\": true|false, \"reason\": \"...\"} only.",
          ].filter(Boolean).join("\n\n");

          const agentEval = await invokeAgentJson(
            "validator",
            model,
            `${evaluatorPrompt}\n\n${userMessage}`,
            { shouldRetry: false, reason: "fallback acceptance" } as any,
            services,
            { traceLabel: `validator:${stepName}`, recursionLimit: 10 }
          );

          const parsed = parseJsonObject(JSON.stringify(agentEval), { shouldRetry: false } as any);
          if (parsed && typeof (parsed as any).shouldRetry === "boolean" && !(parsed as any).shouldRetry) {
            return result; // Agent validator approved output
          }

          const retryReason = (parsed as any)?.reason || "imperfect output";
          lastFeedback = `Validator requested retry: ${retryReason}. Please rectify the output.`;
          if (services) {
            await logMilestoneThinking(services, "Validation", `Agent requested retry for ${stepName}: ${retryReason}`);
          }
        } catch (err) {
          console.warn("[Validator] Evaluator call failed, falling back to output", err);
          return result;
        }
      } else {
        return result;
      }
    } catch (err) {
      lastFeedback = `Execution failed with error: ${String(err)}`;
      if (services) {
        await logMilestoneThinking(
          services,
          "Validation",
          `Validator caught exception in ${stepName} (attempt ${attempt}/${maxRetries + 1}): ${String(err)}`
        );
      }
    }
  }

  if (services) {
    await logMilestoneThinking(services, "Validation", `Validator completed retry cycle for ${stepName}.`);
  }
  return fallback;
}

export default validateWithRetry;
