import fs from "fs/promises";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export async function classifyColumnsWithLLM(profilingFilePath: string): Promise<string> {
  const profilingData = await fs.readFile(profilingFilePath, "utf-8");
  
  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
  });

  const systemMsg = new SystemMessage(`
    You are a data governance and profiling expert. Analyze the provided profiling JSON which contains table samples and basic statistics.
    Your task is to classify columns and identify:
    1. Potential PII (Personally Identifiable Information) like emails, phone numbers, names.
    2. Categorical columns (columns with low cardinality relative to row count).
    3. Potential date/time formats if stored as strings.
    
    Output ONLY valid JSON representing the classification, grouped by table and column, like:
    {
      "users": {
        "email": { "is_pii": true, "type": "categorical", "notes": "Email address" }
      }
    }
  `);

  const humanMsg = new HumanMessage(`Profiling Data JSON:\n${profilingData.substring(0, 50000)}`); // Limit size

  const response = await llm.invoke([systemMsg, humanMsg]);
  
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `llm_classification_${uuidv4()}.json`);

  const outputText = response.content.toString().replace(/```json/g, '').replace(/```/g, '').trim();

  await fs.writeFile(filePath, outputText, "utf-8");
  return filePath;
}
