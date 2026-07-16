import * as parquet from '@dsnp/parquetjs';
import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * Extracts topic names from the columns (schema fields) of a Parquet file.
 * @param filePath Path to the static parquet file
 * @returns Array of topic names
 */
export async function getTopicsFromParquetSchema(filePath: string): Promise<string[]> {
  try {
    const reader = await parquet.ParquetReader.openFile(filePath);
    const schema = reader.schema;
    const topics = Object.keys(schema.fields);
    await reader.close();
    return topics;
  } catch (error) {
    console.error(`Failed to read topics from parquet file ${filePath}:`, error);
    // Fallback topics if file is missing or unreadable
    return [
      "Identity Fields", "Temporal Fields", "Target / Prediction Fields", "Forecast Fields",
      "Operational Fields", "Measurement Fields", "External Factors", "Financial Fields",
      "Location Fields", "Categorical Fields", "Event Fields", "Risk Fields",
      "Quality Fields", "Maintenance Fields", "Resource Fields", "Customer Fields",
      "Inventory Fields", "Feature Engineering Fields", "Label Fields", "Metadata Fields"
    ];
  }
}

/**
 * Writes the resolved dataset-to-topic mappings to a new Parquet file.
 * @param filePath Path for the output resolved parquet file
 * @param mappings Array of mappings containing datasetField and targetTopic
 */
export async function writeResolvedSchemaParquet(
  filePath: string,
  mappings: Array<{ datasetField: string; targetTopic: string }>
): Promise<void> {
  try {
    // Ensure the directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const schema = new parquet.ParquetSchema({
      datasetField: { type: 'UTF8' },
      targetTopic: { type: 'UTF8' },
    });

    const writer = await parquet.ParquetWriter.openFile(schema, filePath);
    for (const mapping of mappings) {
      await writer.appendRow({
        datasetField: mapping.datasetField,
        targetTopic: mapping.targetTopic,
      });
    }
    await writer.close();
  } catch (error) {
    console.error(`Failed to write resolved schema to parquet file ${filePath}:`, error);
  }
}
