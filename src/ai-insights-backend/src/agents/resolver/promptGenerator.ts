import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import fs from "fs/promises";

export async function generateTableSpecificPrompts(
  unifiedSchema: any
): Promise<any[]> {
  const llm = new ChatOpenAI({
    modelName: "gpt-4o", // Strong model for generation
    temperature: 0.1,
  });

  const generatedPrompts: any[] = [];
  const tables = Object.keys(unifiedSchema.tables || {});

  for (const tableName of tables) {
    const tableData = unifiedSchema.tables[tableName];
    
    // Construct a focused view of this table and its direct relationships
    const tableContext = {
      tableName,
      columns: tableData.columns,
      stats: unifiedSchema.stats[tableName] || {},
      classifications: unifiedSchema.classifications[tableName] || {},
      relationships: (unifiedSchema.relationships || []).filter(
        (rel: any) => rel.from_table === tableName || rel.to_table === tableName
      )
    };

    const systemMsg = new SystemMessage(`
      You are an expert database AI schema resolver. 
      Based on the provided table structure, profiling statistics, LLM inferred classifications (like PII), and relationships, 
      generate a focused System Instruction Prompt meant to instruct a future Text-to-SQL agent on how to query THIS SPECIFIC TABLE.
      
      The prompt should include:
      1. Semantic description of the table.
      2. Explanation of its columns and data types.
      3. Callouts for categorical values and PII columns (warn the SQL agent to handle PII safely).
      4. Explicit join instructions based on the relationships.
      
      Return ONLY the final system prompt text.
    `);

    const humanMsg = new HumanMessage(`Table Context JSON:\n${JSON.stringify(tableContext, null, 2)}`);

    const response = await llm.invoke([systemMsg, humanMsg]);
    
    generatedPrompts.push({
      table: tableName,
      prompt: response.content.toString().trim()
    });
  }

  return generatedPrompts;
}

export async function generateSemanticSchema(unifiedSchema: any): Promise<string> {
  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
  });

  const systemMsg = new SystemMessage(`
    You are an expert Data Architect. Summarize the provided database schema JSON into a concise, semantic "Data Dictionary".
    Include high-level entities and how they relate. Output in Markdown format.
  `);

  const humanMsg = new HumanMessage(`Unified Schema JSON:\n${JSON.stringify(unifiedSchema).substring(0, 50000)}`);
  
  const response = await llm.invoke([systemMsg, humanMsg]);
  return response.content.toString().trim();
}
