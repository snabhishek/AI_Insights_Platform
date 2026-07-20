import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { AgentState } from "../state";
import { generateSemanticSchema, generateTableSpecificPrompts } from "./promptGenerator";

export async function schemaResolverNode(state: AgentState): Promise<Partial<AgentState>> {
  const { connectors, sourceStructureFiles, llmInferredRelationshipsFiles, profilingDataFiles } = state;
  if (!connectors || connectors.length === 0) {
    return { errors: ["No connectors provided in state for schema resolver"] };
  }

  const resolvedSchemaFiles: string[] = [];
  const systemPromptFiles: string[] = [];
  const errors: string[] = [];

  // Define persistent storage directory
  const storageDir = path.join(process.cwd(), "persistent_data", "agents");
  await fs.mkdir(storageDir, { recursive: true });

  for (let i = 0; i < connectors.length; i++) {
    const connector = connectors[i];
    
    try {
      // 1. Read all inputs
      const schema = sourceStructureFiles[i] ? JSON.parse(await fs.readFile(sourceStructureFiles[i], "utf-8")) : {};
      const relationships = llmInferredRelationshipsFiles[i] ? JSON.parse(await fs.readFile(llmInferredRelationshipsFiles[i], "utf-8")) : [];
      
      // The profilingDataFiles from 1.2 currently contains the LLM classification output
      // We should ideally read both the raw stats and the classification, but for simplicity, we assume we can read the classified data
      const classifications = profilingDataFiles[i] ? JSON.parse(await fs.readFile(profilingDataFiles[i], "utf-8")) : {};

      // 2. Unify schema
      const unifiedSchema = {
        connectorId: connector.id,
        tables: schema.tables || {},
        relationships: Array.isArray(relationships) ? relationships : [],
        classifications: classifications,
        stats: {} // Would merge raw stats here if we passed them forward
      };

      // 3. Generate Semantic Schema
      const semanticMarkdown = await generateSemanticSchema(unifiedSchema);
      const semanticFilePath = path.join(storageDir, `${connector.id}_semantic_schema.md`);
      await fs.writeFile(semanticFilePath, semanticMarkdown, "utf-8");
      resolvedSchemaFiles.push(semanticFilePath);

      // 4. Generate Table-Specific Prompts
      const tablePrompts = await generateTableSpecificPrompts(unifiedSchema);
      const promptFilePath = path.join(storageDir, `${connector.id}_system_prompts.json`);
      await fs.writeFile(promptFilePath, JSON.stringify(tablePrompts, null, 2), "utf-8");
      systemPromptFiles.push(promptFilePath);

    } catch (err: any) {
      errors.push(`Failed schema resolver on connector ${connector.id}: ${err.message}`);
    }
  }

  return {
    resolvedSchemaFiles: [...(state.resolvedSchemaFiles || []), ...resolvedSchemaFiles],
    systemPromptFiles: [...(state.systemPromptFiles || []), ...systemPromptFiles],
    errors: [...(state.errors || []), ...errors],
  };
}
