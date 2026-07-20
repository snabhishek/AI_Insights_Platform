export function buildResolveSchemaPrompt(
  connector: any,
  inspection: Record<string, unknown>,
  targetParquetTopics: string[],
  userPrompt?: string
): string {
  const safeUserRequest = typeof userPrompt === "string" && userPrompt.trim().length > 0 
    ? userPrompt 
    : "No additional request provided.";

  return `## Role
You are an expert AI Data Architect specialized in schema resolution and data ingestion planning for a dynamic Parquet schema generator.

## Objective
Analyze the discovered tables and fields from the data source inspection, and convert them into a compact, actionable ingestion plan mapping.

## Instructions
1. Review the "Inspection context" carefully to understand the tables, columns, and data types available in the source.
2. Consider the "User request" (if any) to filter or prioritize specific tables for ingestion.
3. Map every dataset field to one of the target Parquet topics. 
4. If the dataset contains fields that do not fit the existing static topics, create new, appropriate category names and use them as target topics in your mappings.
5. The downstream system will use your mappings to generate a Snappy-compressed Parquet file where the topics act as columns, and the dataset fields are grouped into comma-separated strings inside a single row.

## Static Parquet Topics
${JSON.stringify(targetParquetTopics, null, 2)}

## Required JSON Shape
Return valid JSON ONLY using this exact shape. Do not include markdown formatting blocks (like \`\`\`json) or any conversational text.
{
  "resolvedTables": ["string"],
  "strategy": "string",
  "mappings": [
    {
      "datasetField": "string",
      "targetTopic": "string"
    }
  ],
  "unmappedDatasetFields": ["string"]
}

## Context
### Inspection Context
${JSON.stringify({ connector, inspection }, null, 2)}

### User Request
${safeUserRequest}
`;
}
