import { z } from "zod";
import { ISparrowExecutionService } from "../../../services/ai/sparrow-execution/sparrowExecution.service";
import { SparrowState } from "../sparrowState";

export function createExecuteProjectScriptTool(projectId: string, executionService: ISparrowExecutionService) {
  return {
    name: "executeProjectScript",
    description: "Delegate a concrete Python task to Sparrow's independent script worker. It inspects and adapts existing project scripts or writes a new runner, executes in Docker with read-only inputs, and returns verified output and artifacts. Use SQL/calculation tools for simpler tasks; use runModelInference for dated saved-model forecasts.",
    schema: z.object({ task: z.string().min(1).max(12000) }).strict(),
    invokeWithContext: async (args: { task: string }, state: SparrowState, runtime: { onProgress: (text: string) => void }) => {
      const result = await executionService.execute({ projectId, task: args.task,
        evidence: { userQuery: state.userQuery, understanding: state.queryUnderstanding, toolResults: state.toolResults,
          clarificationReplies: state.clarificationHistory } }, runtime.onProgress);
      return { success: result.success, ...(result.success ? { results: result.output } : { error: result.error }), artifacts: result.artifacts };
    },
  };
}
