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
 * Loads the static Schema.yaml content from the packages folder.
 */
export async function loadFieldSchemaYaml(): Promise<string> {
  const schemaPath = resolvePackageFilePath("Schema.yaml");
  if (fsSync.existsSync(schemaPath)) {
    try {
      return await fs.readFile(schemaPath, "utf-8");
    } catch (err) {
      console.warn(`Failed to read Schema.yaml at ${schemaPath}:`, err);
    }
  }
  return "";
}

/**
 * Resolves the path of an existing schema file for a project inside packages/ProjectFiles/<Workspace>-<Project>/Schemas/.
 */
export async function getProjectSchemaPath(
  workspaceName?: string,
  projectName?: string
): Promise<string | null> {
  if (!workspaceName || !projectName) return null;
  const packagesDir = getPackagesDir();
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectName);
  const folderName = `${cleanWsName}-${cleanProjectTitle}`;

  const candidateDirs = [
    path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas"),
    path.resolve(packagesDir, folderName, "Schemas"),
  ];

  for (const cDir of candidateDirs) {
    if (fsSync.existsSync(cDir)) {
      try {
        const files = await fs.readdir(cDir);
        const yamlFiles = files
          .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
          .sort();
        if (yamlFiles.length > 0) {
          return path.resolve(cDir, yamlFiles[yamlFiles.length - 1]);
        }
      } catch (err) {
        console.warn(`[getProjectSchemaPath] Failed readdir on ${cDir}:`, err);
      }
    }
  }
  return null;
}

/**
 * Loads the project schema YAML from packages/ProjectFiles if present,
 * or falls back to static Schema.yaml if not found.
 */
export async function loadProjectOrFieldSchemaYaml(
  workspaceName?: string,
  projectName?: string
): Promise<{ content: string; sourcePath: string; isProjectSchema: boolean }> {
  const projectFilePath = await getProjectSchemaPath(workspaceName, projectName);
  if (projectFilePath && fsSync.existsSync(projectFilePath)) {
    try {
      const content = await fs.readFile(projectFilePath, "utf-8");
      return { content, sourcePath: projectFilePath, isProjectSchema: true };
    } catch (err) {
      console.warn(`[loadProjectOrFieldSchemaYaml] Failed to read project schema file at ${projectFilePath}:`, err);
    }
  }
  const defaultSchemaPath = resolvePackageFilePath("Schema.yaml");
  const content = await loadFieldSchemaYaml();
  return { content, sourcePath: defaultSchemaPath, isProjectSchema: false };
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

    const fieldsObj: Record<string, any> = {
      DomainKnowledge: {
        Tier1: payload.domainKnowledge?.tier1 || "General Industry",
        Tier2: payload.domainKnowledge?.tier2 || "General Business Domain",
        UseCase: payload.domainKnowledge?.useCase || "Data Analytics & Ingestion",
        UseCaseDescription: payload.domainKnowledge?.useCaseDescription || payload.domain || "General Business Domain"
      },
      ...groupedTopics
    };

    const schemaData = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      resolvedTables: payload.resolvedTables || [],
      strategy: payload.strategy || "inspect-and-map",
      fields: fieldsObj
    };

    const yamlContent = yaml.dump(schemaData, { indent: 2, lineWidth: -1, noRefs: true });
    await fs.writeFile(filePath, yamlContent, 'utf-8');
  } catch (error) {
    console.error(`Failed to write resolved schema YAML file to ${filePath}:`, error);
  }
}

export interface ProjectSchemaInput {
  name: string;
  domain?: string;
  subDomain?: string;
  useCase?: string;
}

/**
 * Creates the project folder inside packages and generates the initial schema file
 * by copying Schema.yaml and updating the DomainKnowledge hierarchy fields.
 */
export async function createProjectSchemaFile(
  workspaceName: string,
  projectInput: ProjectSchemaInput
): Promise<string> {
  const packagesDir = getPackagesDir();
  const rawYaml = await loadFieldSchemaYaml();
  
  let schemaObj: any = {};
  if (rawYaml) {
    try {
      schemaObj = yaml.load(rawYaml) || {};
    } catch (e) {
      console.warn("[createProjectSchemaFile] Failed to parse Schema.yaml, initializing empty object", e);
      schemaObj = {};
    }
  }

  if (!schemaObj.fields) {
    schemaObj.fields = {};
  }
  if (!schemaObj.fields.DomainKnowledge) {
    schemaObj.fields.DomainKnowledge = {};
  }

  const dk = schemaObj.fields.DomainKnowledge;
  dk.Tier1 = projectInput.domain && projectInput.domain.trim().length > 0 ? projectInput.domain.trim() : (dk.Tier1 || "User Provided");
  dk.Tier2 = projectInput.subDomain && projectInput.subDomain.trim().length > 0 ? projectInput.subDomain.trim() : (dk.Tier2 || "User Provided");
  dk.UseCase = projectInput.name && projectInput.name.trim().length > 0 ? projectInput.name.trim() : (dk.UseCase || "");
  dk.UseCaseDescription = projectInput.useCase && projectInput.useCase.trim().length > 0 ? projectInput.useCase.trim() : (dk.UseCaseDescription || "");

  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectInput.name);
  const folderName = `${cleanWsName}-${cleanProjectTitle}`;
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = generateDateTimeStamp();
  const fileName = `${useCaseSlug}_schema_${timestamp}.yaml`;

  const targetDir = path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  const targetPath = path.resolve(targetDir, fileName);
  const dumpedYaml = yaml.dump(schemaObj, { indent: 2, lineWidth: -1, noRefs: true });
  await fs.writeFile(targetPath, dumpedYaml, "utf-8");

  console.info(`[createProjectSchemaFile] Created project schema file at ${targetPath}`);
  return targetPath;
}

/**
 * Searches for an existing schema file under packages for the given project folder convention.
 * If found, updates it with Schema Resolver findings; if not found, creates and populates it.
 */
export async function updateOrCreateProjectSchemaFile(
  workspaceName: string,
  projectTitle: string,
  projectInput: ProjectSchemaInput,
  payload: ResolvedSchemaPayload
): Promise<string> {
  const packagesDir = getPackagesDir();
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectTitle);
  const folderName = `${cleanWsName}-${cleanProjectTitle}`;
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const candidateDirs = [
    path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas"),
    path.resolve(packagesDir, folderName, "Schemas"),
  ];

  let targetDir: string | null = null;
  let existingFilePath: string | null = null;

  for (const cDir of candidateDirs) {
    if (fsSync.existsSync(cDir)) {
      targetDir = cDir;
      try {
        const files = await fs.readdir(cDir);
        const yamlFiles = files
          .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
          .sort();
        if (yamlFiles.length > 0) {
          existingFilePath = path.resolve(cDir, yamlFiles[yamlFiles.length - 1]);
        }
      } catch (err) {
        console.warn(`[updateOrCreateProjectSchemaFile] Failed readdir on ${cDir}:`, err);
      }
      break;
    }
  }

  let schemaObj: any = {};
  let targetFilePath: string;

  if (existingFilePath && fsSync.existsSync(existingFilePath)) {
    targetFilePath = existingFilePath;
    try {
      const content = await fs.readFile(existingFilePath, "utf-8");
      schemaObj = yaml.load(content) || {};
    } catch (err) {
      console.warn(`[updateOrCreateProjectSchemaFile] Failed to parse existing schema file ${existingFilePath}:`, err);
      schemaObj = {};
    }
  } else {
    if (!targetDir) {
      targetDir = path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas");
    }
    await fs.mkdir(targetDir, { recursive: true });
    const timestamp = generateDateTimeStamp();
    const fileName = `${useCaseSlug}_schema_${timestamp}.yaml`;
    targetFilePath = path.resolve(targetDir, fileName);

    const rawYaml = await loadFieldSchemaYaml();
    if (rawYaml) {
      try {
        schemaObj = yaml.load(rawYaml) || {};
      } catch (e) {
        schemaObj = {};
      }
    }
  }

  if (!schemaObj.fields) {
    schemaObj.fields = {};
  }
  if (!schemaObj.fields.DomainKnowledge) {
    schemaObj.fields.DomainKnowledge = {};
  }

  const dk = schemaObj.fields.DomainKnowledge;
  if (projectInput.domain && projectInput.domain.trim().length > 0) dk.Tier1 = projectInput.domain.trim();
  if (projectInput.subDomain && projectInput.subDomain.trim().length > 0) dk.Tier2 = projectInput.subDomain.trim();
  if (projectInput.name && projectInput.name.trim().length > 0) dk.UseCase = projectInput.name.trim();
  if (projectInput.useCase && projectInput.useCase.trim().length > 0) dk.UseCaseDescription = projectInput.useCase.trim();

  if (payload.domainKnowledge) {
    if (payload.domainKnowledge.tier1) dk.Tier1 = payload.domainKnowledge.tier1;
    if (payload.domainKnowledge.tier2) dk.Tier2 = payload.domainKnowledge.tier2;
    if (payload.domainKnowledge.useCase) dk.UseCase = payload.domainKnowledge.useCase;
    if (payload.domainKnowledge.useCaseDescription) dk.UseCaseDescription = payload.domainKnowledge.useCaseDescription;
  }

  schemaObj.generatedAt = new Date().toISOString();
  schemaObj.resolvedTables = payload.resolvedTables || [];
  schemaObj.strategy = payload.strategy || "inspect-and-map";

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

  // Update schemaObj.fields categories with mapped dataset fields
  for (const [topic, mappedFields] of Object.entries(groupedTopics)) {
    if (schemaObj.fields[topic] && typeof schemaObj.fields[topic] === "object" && !Array.isArray(schemaObj.fields[topic])) {
      schemaObj.fields[topic].dataset_fields = mappedFields;
    } else {
      schemaObj.fields[topic] = mappedFields;
    }
  }

  // Remove unwanted legacy/duplicate top-level keys
  delete schemaObj.topics;
  delete schemaObj.mappings;
  delete schemaObj.unmappedDatasetFields;
  delete schemaObj.unmappedfields;
  delete schemaObj.domainKnowledge;

  const dumpedYaml = yaml.dump(schemaObj, { indent: 2, lineWidth: -1, noRefs: true });
  await fs.writeFile(targetFilePath, dumpedYaml, "utf-8");
  console.info(`[updateOrCreateProjectSchemaFile] Updated project schema file at ${targetFilePath}`);
  return targetFilePath;
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

/**
 * Deletes the project folder inside packages (e.g. packages/ProjectFiles/WorkspaceName-UseCaseTitle or packages/WorkspaceName-UseCaseTitle).
 */
export async function deleteProjectSchemaFolder(
  workspaceName: string,
  projectName: string
): Promise<boolean> {
  try {
    const packagesDir = getPackagesDir();
    const cleanWsName = sanitizeName(workspaceName);
    const cleanProjectTitle = sanitizeName(projectName);
    const folderName = `${cleanWsName}-${cleanProjectTitle}`;

    const candidateDirs = [
      path.resolve(packagesDir, "ProjectFiles", folderName),
      path.resolve(packagesDir, folderName),
    ];

    let deletedAny = false;
    for (const dir of candidateDirs) {
      if (fsSync.existsSync(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
        console.info(`[deleteProjectSchemaFolder] Deleted project folder at ${dir}`);
        deletedAny = true;
      }
    }
    return deletedAny;
  } catch (error) {
    console.error(`[deleteProjectSchemaFolder] Error deleting project folder for ${workspaceName}-${projectName}:`, error);
    return false;
  }
}


