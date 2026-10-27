import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SupportedChatModel } from "../../utils/agentUtils";
import { extractModelText, getLatestAgentMessage } from "../../utils/agentUtils";
import { lifecycleAgentMiddlewares } from "../agentRuntime";

export function createStatelessSubagentTool(
  model: SupportedChatModel,
  availableTools: unknown[] = []
) {
  return tool(
    async ({ role, task, context }: { role: string; task: string; context: string }) => {
      const subagent = createAgent({
        model,
        tools: availableTools as never[],
        systemPrompt: `You are a stateless specialist subagent for the role "${role}". Use only the task and context supplied in this invocation. Do not assume memory from prior work. Return a concise, evidence-grounded result.`,
        middleware: lifecycleAgentMiddlewares(model),
      });
      const result = await subagent.invoke({
        messages: [
          new SystemMessage(`Specialist role: ${role}`),
          new HumanMessage(JSON.stringify({ task, context })),
        ],
      });
      return extractModelText(getLatestAgentMessage(result));
    },
    {
      name: "delegate_stateless_subagent",
      description: "Delegate a bounded research or review task to a fresh subagent with no retained memory.",
      schema: z.object({
        role: z.string(),
        task: z.string(),
        context: z.string(),
      }),
    }
  );
}
