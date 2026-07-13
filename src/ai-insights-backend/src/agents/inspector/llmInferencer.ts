import fs from "fs/promises";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export async function inferRelationshipsWithLLM(schemaFilePath: string): Promise<string> {
  const schemaData = await fs.readFile(schemaFilePath, "utf-8");
  
  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini", // Use an appropriate model
    temperature: 0,
  });

  const systemMsg = new SystemMessage(`
    You are a database architect. Analyze the provided database schema JSON.
    Your task is to heuristically infer potential primary keys, foreign keys, and relationships 
    between tables based on column names (e.g. 'user_id', 'org_id') and data types.
    Output ONLY valid JSON representing the relationships, like:
    [
      { "from_table": "users", "from_column": "id", "to_table": "posts", "to_column": "user_id" }
    ]
  `);

  const humanMsg = new HumanMessage(`Schema JSON:\n${schemaData.substring(0, 50000)}`); // Limit size

  const response = await llm.invoke([systemMsg, humanMsg]);
  
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `llm_inference_${uuidv4()}.json`);

  const outputText = response.content.toString().replace(/```json/g, '').replace(/```/g, '').trim();

  await fs.writeFile(filePath, outputText, "utf-8");
  return filePath;
}
