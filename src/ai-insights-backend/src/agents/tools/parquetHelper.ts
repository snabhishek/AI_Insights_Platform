import * as parquet from '@dsnp/parquetjs';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Extracts the top-level column names (topics) from a Parquet file schema.
 * @param filePath Path to the static parquet file
 * @returns Array of column names (topics)
 */
export async function getTopicsFromParquetSchema(filePath: string): Promise<string[]> {
  try {
    const reader = await parquet.ParquetReader.openFile(filePath);
    const schema = reader.getSchema();
    const fields = schema.fields;
    
    const topics = Object.keys(fields);
    await reader.close();
    
    return topics;
  } catch (error) {
    console.error(`Failed to read topics from parquet file ${filePath}:`, error);
    return [];
  }
}

/**
 * Writes the resolved dataset-to-topic mappings to a new Parquet file.
 * @param filePath Path for the output resolved parquet file
 * @param mappings Array of mappings containing datasetField and targetTopic
 * @param staticTopics Array of static topics to ensure they exist as columns
 */
export async function writeResolvedSchemaParquet(
  filePath: string,
  mappings: Array<{ datasetField: string; targetTopic: string }>,
  staticTopics: string[] = []
): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // 1. Group dataset fields by topic
    const groupedMappings: Record<string, string[]> = {};
    
    // Initialize static topics to ensure they are always present as columns
    for (const topic of staticTopics) {
      groupedMappings[topic] = [];
    }

    // Add mapped fields (including any new topics recommended by the LLM)
    for (const mapping of mappings) {
      const topic = mapping.targetTopic;
      if (!groupedMappings[topic]) {
        groupedMappings[topic] = [];
      }
      groupedMappings[topic].push(mapping.datasetField);
    }

    // 2. Build dynamic Parquet schema with SNAPPY compression
    const schemaFields: Record<string, any> = {};
    const rowData: Record<string, string> = {};

    for (const [topic, fields] of Object.entries(groupedMappings)) {
      schemaFields[topic] = { type: 'UTF8', compression: 'SNAPPY', optional: true };
      // Join fields with commas, or leave null if empty
      rowData[topic] = fields.length > 0 ? fields.join(',') : '';
    }

    const schema = new parquet.ParquetSchema(schemaFields);

    // 3. Write a single row with the grouped, comma-separated data
    const writer = await parquet.ParquetWriter.openFile(schema, filePath);
    await writer.appendRow(rowData);
    await writer.close();
  } catch (error) {
    console.error(`Failed to write resolved schema to parquet file ${filePath}:`, error);
  }
}

/**
 * Sanitizes a string for use in folder and file names.
 */
export function sanitizeName(name: string): string {
  if (!name || typeof name !== "string") return "Default";
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ");
  return clean || "Default";
}

/**
 * Generates a DateTimeStamp formatted as YYYYMMDD-HHmmss
 */
export function generateDateTimeStamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

