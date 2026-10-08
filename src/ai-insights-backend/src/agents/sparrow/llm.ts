import { readFile } from "fs/promises";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getModel, resolvePromptFilePath } from "../utils/agentUtils";

// One prompt source; configuration and malformed output errors stay explicit.
export async function invokeSparrowJson<T extends Record<string, unknown>>(promptName: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
  const model = getModel();
  if (!model) throw new Error("Configure an LLM provider before using Sparrow.");
  
  const prompt = await readFile(resolvePromptFilePath(promptName), "utf8");
  if (!prompt.trim()) throw new Error(`Sparrow prompt '${promptName}' is empty.`);
  
  const structuredModel = model.withStructuredOutput(schema, { name: "sparrow_output", method: "functionCalling" });
  
  const result = await structuredModel.invoke([
    new SystemMessage(prompt), new HumanMessage(JSON.stringify(payload)),
  ], { signal: AbortSignal.timeout(60_000) });
  
  return schema.parse(result);
}
