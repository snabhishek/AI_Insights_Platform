import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface RelationshipDetails {
  relatedField: string;
  relationshipType: string;
  explanation: string;
}

export interface DetailedTopicMapping {
  datasetField: string;
  targetTopic: string;
  subtype?: string;
  priority?: string;
  priorityRationale?: string;
  sensitiveSubtype?: string | null;
  relationship?: RelationshipDetails;
}

export interface DomainKnowledgeDetails {
  tier1: string;
  tier2: string;
  useCase: string;
  useCaseDescription: string;
}

export interface ResolvedSchemaPayload {
  domainKnowledge?: DomainKnowledgeDetails;
  domain?: string;
  resolvedTables?: string[];
  strategy?: string;
  mappings: DetailedTopicMapping[];
  unmappedDatasetFields?: string[];
}

/**
 * Resolves the root packages directory across various execution contexts (root, src/backend, dist).
 */
export function getPackagesDir(): string {
  const candidateDirs = [
    path.resolve(__dirname, "../../../../../packages"),
    path.resolve(process.cwd(), "../packages"),
    path.resolve(process.cwd(), "src/packages"),
    path.resolve(__dirname, "../../../packages"),
  ];
  for (const dir of candidateDirs) {
    if (fsSync.existsSync(dir)) {
      return dir;
    }
  }
  return candidateDirs[0];
}

/**
 * Resolves the location of candidate package files in the workspace.
 */
export function resolvePackageFilePath(filename: string): string {
  const candidatePaths = [
    path.join(getPackagesDir(), filename),
    path.resolve(__dirname, "../../../../../packages", filename),
    path.resolve(process.cwd(), "../packages", filename),
    path.resolve(process.cwd(), "src/packages", filename),
  ];
  for (const candidate of candidatePaths) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidatePaths[0];
}

/**
 * Loads the static field_schema.yaml content from the packages folder.
 */
export async function loadFieldSchemaYaml(): Promise<string> {
  const schemaPath = resolvePackageFilePath("field_schema.yaml");
  if (fsSync.existsSync(schemaPath)) {
    try {
      return await fs.readFile(schemaPath, "utf-8");
    } catch (err) {
      console.warn(`Failed to read field_schema.yaml at ${schemaPath}:`, err);
    }
  }
  return "";
}

/**
 * Writes the resolved dataset-to-topic mappings and domain knowledge to a structured YAML file.
 */
export async function writeResolvedSchemaYaml(
  filePath: string,
  payload: ResolvedSchemaPayload
): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Group dataset fields by topic
    const groupedTopics: Record<string, any[]> = {};

    for (const mapping of payload.mappings || []) {
      const topic = mapping.targetTopic || "General";
      if (!groupedTopics[topic]) {
        groupedTopics[topic] = [];
      }
      groupedTopics[topic].push({
        field: mapping.datasetField,
        subtype: mapping.subtype || null,
        priority: mapping.priority || "Medium",
        priorityRationale: mapping.priorityRationale || null,
        sensitiveSubtype: mapping.sensitiveSubtype || null,
        relationship: mapping.relationship || null,
      });
    }

    const schemaData = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      domainKnowledge: payload.domainKnowledge || {
        tier1: "General Industry",
        tier2: "General Business Domain",
        useCase: "Data Analytics & Ingestion",
        useCaseDescription: payload.domain || "General Business Domain"
      },
      resolvedTables: payload.resolvedTables || [],
      strategy: payload.strategy || "inspect-and-map",
      topics: groupedTopics,
      mappings: payload.mappings || [],
      unmappedDatasetFields: payload.unmappedDatasetFields || []
    };

    const yamlContent = yaml.dump(schemaData, { indent: 2 });
    await fs.writeFile(filePath, yamlContent, 'utf-8');
  } catch (error) {
    console.error(`Failed to write resolved schema YAML file to ${filePath}:`, error);
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
