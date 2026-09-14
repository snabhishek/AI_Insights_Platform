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
  relatedField?: string | null;
  related_field?: string | null;
  relationshipType?: string | null;
  relationship_type?: string | null;
  explanation?: string | null;
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
 * Defaults to backend/storage/packages as per updated specification.
 */
export function getPackagesDir(): string {
  const candidateDirs = [
    path.resolve(process.cwd(), "storage/packages"),
    path.resolve(__dirname, "../../../../storage/packages"),
    path.resolve(__dirname, "../../../storage/packages"),
    path.resolve(process.cwd(), "../storage/packages"),
    path.resolve(process.cwd(), "../packages"),
    path.resolve(__dirname, "../../../../../packages"),
    path.resolve(process.cwd(), "../../packages"),
    path.resolve(process.cwd(), "uploads/packages"),
  ];
  for (const dir of candidateDirs) {
    if (
      fsSync.existsSync(dir) &&
      (fsSync.existsSync(path.join(dir, "Schemas")) ||
        fsSync.existsSync(path.join(dir, "projectFiles")) ||
        fsSync.existsSync(path.join(dir, "ProjectFiles")))
    ) {
      return dir;
    }
  }
  for (const dir of candidateDirs) {
    if (fsSync.existsSync(dir)) {
      return dir;
    }
  }
  return candidateDirs[0];
}

/**
 * Resolves the projectFiles parent directory inside packages (checking projectFiles or ProjectFiles).
 */
export function getProjectFilesParent(packagesDir: string): string {
  const candidates = ["projectFiles", "ProjectFiles"];
  for (const name of candidates) {
    const dir = path.resolve(packagesDir, name);
    if (fsSync.existsSync(dir)) {
      return dir;
    }
  }
  return path.resolve(packagesDir, "projectFiles");
}

/**
 * Resolves the project folder name inside projectFiles/ (projectName preferred, fallback to legacy workspaceName-projectName).
 */
export function resolveProjectFolderName(
  projectFilesParent: string,
  projectName: string,
  workspaceName?: string
): string {
  const cleanProjectTitle = sanitizeName(projectName);
  // 1. Prefer projectName directly (e.g. backend/storage/packages/projectFiles/projectName/)
  if (fsSync.existsSync(path.resolve(projectFilesParent, cleanProjectTitle))) {
    return cleanProjectTitle;
  }
  // 2. Fallback to legacy workspaceName-projectName if that existing directory is on disk
  if (workspaceName) {
    const cleanWsName = sanitizeName(workspaceName);
    const legacyName = `${cleanWsName}-${cleanProjectTitle}`;
    if (fsSync.existsSync(path.resolve(projectFilesParent, legacyName))) {
      return legacyName;
    }
  }
  // 3. Otherwise standard is cleanProjectTitle (projectName)
  return cleanProjectTitle;
}

/**
 * Resolves the location of candidate package files in the workspace.
 */
export function resolvePackageFilePath(filename: string): string {
  const packagesDir = getPackagesDir();
  const candidatePaths = [
    path.join(packagesDir, "Schemas", filename),
    path.join(packagesDir, filename),
    path.resolve(process.cwd(), "storage/packages/Schemas", filename),
    path.resolve(__dirname, "../../../../storage/packages/Schemas", filename),
    path.resolve(__dirname, "../../../../../packages/Schemas", filename),
    path.resolve(__dirname, "../../../../../packages", filename),
    path.resolve(process.cwd(), "../packages/Schemas", filename),
    path.resolve(process.cwd(), "../packages", filename),
    path.resolve(process.cwd(), "src/packages/Schemas", filename),
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
 * Loads and merges the base modular schema files (Domain.yaml, DataIngestion.yaml, FeatureEngineering.yaml)
 * from the packages/Schemas folder.
 */
export async function loadFieldSchemaYaml(): Promise<string> {
  const packagesDir = getPackagesDir();
  const schemasDir = path.resolve(packagesDir, "Schemas");
  if (fsSync.existsSync(schemasDir)) {
    try {
      const mergedObj: any = { version: "1.0", generatedAt: new Date().toISOString(), fields: {} };
      const modularFiles = ["Domain.yaml", "DataIngestion.yaml", "FeatureEngineering.yaml"];
      for (const file of modularFiles) {
        const filePath = path.resolve(schemasDir, file);
        if (fsSync.existsSync(filePath)) {
          const content = await fs.readFile(filePath, "utf-8");
          const parsed: any = yaml.load(content) || {};
          if (parsed.DomainKnowledge) mergedObj.fields.DomainKnowledge = parsed.DomainKnowledge;
          if (parsed.fields) Object.assign(mergedObj.fields, parsed.fields);
          if (parsed.FeatureEngineering) mergedObj.fields.FeatureEngineering = parsed.FeatureEngineering;
        }
      }
      return yaml.dump(mergedObj, { indent: 2, lineWidth: -1, noRefs: true });
    } catch (err) {
      console.warn(`[loadFieldSchemaYaml] Failed to merge modular schemas at ${schemasDir}:`, err);
    }
  }
  return "";
}

/**
 * Resolves the path of an existing schema file for a project inside packages/projectFiles/<Project>/Schemas/.
 */
export async function getProjectSchemaDirs(
  workspaceName?: string,
  projectName?: string
): Promise<string[]> {
  if (!workspaceName && !projectName) return [];
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanWsName = workspaceName ? sanitizeName(workspaceName) : "";
  const cleanProjectTitle = projectName ? sanitizeName(projectName) : "";

  // Check both cleanProjectTitle (projectName) and legacy cleanWsName-cleanProjectTitle
  const candidateFolderNames: string[] = [];
  if (cleanProjectTitle) candidateFolderNames.push(cleanProjectTitle);
  if (cleanWsName && cleanProjectTitle) candidateFolderNames.push(`${cleanWsName}-${cleanProjectTitle}`);

  const results: string[] = [];

  // 1. Scan nested run subfolders inside projectFilesParent/<folderName>/
  for (const parentFolderName of candidateFolderNames) {
    const projectParentDir = path.resolve(projectFilesParent, parentFolderName);
    if (fsSync.existsSync(projectParentDir)) {
      try {
        const subEntries = await fs.readdir(projectParentDir);
        const sortedSubEntries = subEntries.sort((a, b) => b.localeCompare(a));
        for (const subEntry of sortedSubEntries) {
          const subSchemaDir = path.resolve(projectParentDir, subEntry, "Schemas");
          if (fsSync.existsSync(subSchemaDir) && !results.includes(subSchemaDir)) {
            results.push(subSchemaDir);
          } else {
            const directSubDir = path.resolve(projectParentDir, subEntry);
            if (fsSync.existsSync(directSubDir) && fsSync.statSync(directSubDir).isDirectory() && !results.includes(directSubDir)) {
              results.push(directSubDir);
            }
          }
        }

        // Check Schemas directly under main project dir
        const directParentSchemas = path.resolve(projectParentDir, "Schemas");
        if (fsSync.existsSync(directParentSchemas) && !results.includes(directParentSchemas)) {
          results.push(directParentSchemas);
        }
      } catch {}
    }
  }

  // 2. Scan legacy flat directories matching projectFilesParent/<folderName>_*
  if (fsSync.existsSync(projectFilesParent)) {
    try {
      const entries = await fs.readdir(projectFilesParent);
      for (const parentFolderName of candidateFolderNames) {
        const matchingFlat = entries
          .filter((e) => e.startsWith(`${parentFolderName}_`) || e.toLowerCase().startsWith(`${parentFolderName.toLowerCase()}_`))
          .sort((a, b) => b.localeCompare(a));

        for (const entry of matchingFlat) {
          const schemaDir = path.resolve(projectFilesParent, entry, "Schemas");
          if (fsSync.existsSync(schemaDir) && !results.includes(schemaDir)) {
            results.push(schemaDir);
          } else {
            const directDir = path.resolve(projectFilesParent, entry);
            if (fsSync.existsSync(directDir) && !results.includes(directDir)) {
              results.push(directDir);
            }
          }
        }
      }
    } catch {}
  }

  return results;
}

/**
 * Resolves the path of an existing schema file for a project inside packages/ProjectFiles/<Workspace>-<Project>/Schemas/.
 */
export async function getProjectSchemaPath(
  workspaceName?: string,
  projectName?: string
): Promise<string | null> {
  const candidateDirs = await getProjectSchemaDirs(workspaceName, projectName);

  for (const cDir of candidateDirs) {
    try {
      const files = await fs.readdir(cDir);
      const domainFile = files.find((f) => f.includes("_domain_") && (f.endsWith(".yaml") || f.endsWith(".yml")));
      if (domainFile) {
        return path.resolve(cDir, domainFile);
      }
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
  return null;
}

/**
 * Loads the project schema YAML from packages/ProjectFiles if present,
 * merging modular schemas, or falls back to base modular Schema files.
 */
export async function loadProjectOrFieldSchemaYaml(
  workspaceName?: string,
  projectName?: string
): Promise<{ content: string; sourcePath: string; isProjectSchema: boolean }> {
  if (workspaceName && projectName) {
    const candidateDirs = await getProjectSchemaDirs(workspaceName, projectName);

    for (const targetDir of candidateDirs) {
      try {
        const files = await fs.readdir(targetDir);
        const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
        if (yamlFiles.length > 0) {
          const mergedObj: any = { version: "1.0", generatedAt: new Date().toISOString(), fields: {} };
          for (const file of yamlFiles) {
            const filePath = path.resolve(targetDir, file);
            const content = await fs.readFile(filePath, "utf-8");
            const parsed: any = yaml.load(content) || {};
            if (parsed.DomainKnowledge) mergedObj.fields.DomainKnowledge = parsed.DomainKnowledge;
            if (parsed.fields) Object.assign(mergedObj.fields, parsed.fields);
            if (parsed.FeatureEngineering) mergedObj.fields.FeatureEngineering = parsed.FeatureEngineering;
            if (parsed.Relationship) mergedObj.fields.Relationship = parsed.Relationship;
          }
          const mergedContent = yaml.dump(mergedObj, { indent: 2, lineWidth: -1, noRefs: true });
          const domainPath = path.resolve(targetDir, yamlFiles.find(f => f.includes("_domain_")) || yamlFiles[0]);
          return { content: mergedContent, sourcePath: domainPath, isProjectSchema: true };
        }
      } catch (err) {
        console.warn(`[loadProjectOrFieldSchemaYaml] Failed reading project dir ${targetDir}:`, err);
      }
    }
  }

  const defaultSchemaPath = resolvePackageFilePath("Domain.yaml");
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
 * Creates the project folder inside packages/projectFiles/<Project>/Schemas
 * and updates the Domain.yaml modular schema with domain knowledge from project creation.
 * The Domain file is named `<usecasetitle>_domain_<timestamp>.yaml`.
 * Remaining modular schema templates (DataIngestion.yaml, FeatureEngineering.yaml) are copied into the folder.
 * Any legacy single schema file (*_schema_*.yaml) is removed.
 */
export async function createProjectSchemaFile(
  workspaceName: string,
  projectInput: ProjectSchemaInput
): Promise<string> {
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanProjectTitle = sanitizeName(projectInput.name);
  const folderName = resolveProjectFolderName(projectFilesParent, projectInput.name, workspaceName);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = generateDateTimeStamp();
  const domainFileName = `${useCaseSlug}_domain_${timestamp}.yaml`;

  const targetDir = path.resolve(projectFilesParent, folderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  // Remove any old legacy single schema files (*_schema_*.yaml) inside targetDir
  try {
    const existingFiles = await fs.readdir(targetDir);
    for (const f of existingFiles) {
      if (f.includes("_schema_") && (f.endsWith(".yaml") || f.endsWith(".yml"))) {
        await fs.unlink(path.resolve(targetDir, f));
        console.info(`[createProjectSchemaFile] Removed legacy single schema file: ${f}`);
      }
    }
  } catch (cleanErr) {
    console.warn(`[createProjectSchemaFile] Warning during cleanup of old single schema files:`, cleanErr);
  }

  // Load Domain.yaml template from packages/Schemas
  const domainTemplatePath = resolvePackageFilePath("Domain.yaml");
  let domainObj: any = {};
  if (fsSync.existsSync(domainTemplatePath)) {
    try {
      const rawDomain = await fs.readFile(domainTemplatePath, "utf-8");
      domainObj = yaml.load(rawDomain) || {};
    } catch (e) {
      console.warn("[createProjectSchemaFile] Failed to parse Domain.yaml template, initializing standard object", e);
    }
  }

  if (!domainObj.DomainKnowledge) {
    domainObj.DomainKnowledge = {};
  }

  const dk = domainObj.DomainKnowledge;
  dk.Tier1 = projectInput.domain && projectInput.domain.trim().length > 0 ? projectInput.domain.trim() : (dk.Tier1 || "User Provided");
  dk.Tier2 = projectInput.subDomain && projectInput.subDomain.trim().length > 0 ? projectInput.subDomain.trim() : (dk.Tier2 || "User Provided");
  dk.UseCase = projectInput.name && projectInput.name.trim().length > 0 ? projectInput.name.trim() : (dk.UseCase || "");
  dk.UseCaseDescription = projectInput.useCase && projectInput.useCase.trim().length > 0 ? projectInput.useCase.trim() : (dk.UseCaseDescription || "");
  domainObj.generatedAt = new Date().toISOString();

  const domainTargetPath = path.resolve(targetDir, domainFileName);
  const dumpedDomainYaml = yaml.dump(domainObj, { indent: 2, lineWidth: -1, noRefs: true });
  await fs.writeFile(domainTargetPath, dumpedDomainYaml, "utf-8");
  console.info(`[createProjectSchemaFile] Created project domain schema file at ${domainTargetPath}`);

  return domainTargetPath;
}

/**
 * Searches for modular schema files under packages/projectFiles for the given project folder convention.
 * Updates <usecasetitle>_domain_<timestamp>.yaml with domain knowledge and updates modular schemas with resolved mappings.
 * Removes legacy single schema files if present.
 */
export async function updateOrCreateProjectSchemaFile(
  workspaceName: string,
  projectTitle: string,
  projectInput: ProjectSchemaInput,
  payload: ResolvedSchemaPayload
): Promise<string> {
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectTitle);
  const folderName = resolveProjectFolderName(projectFilesParent, projectTitle, workspaceName);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const candidateDirs = [
    path.resolve(projectFilesParent, folderName, "Schemas"),
    path.resolve(projectFilesParent, cleanProjectTitle, "Schemas"),
    path.resolve(projectFilesParent, `${cleanWsName}-${cleanProjectTitle}`, "Schemas"),
    path.resolve(packagesDir, folderName, "Schemas"),
  ];

  let targetDir: string | null = null;
  for (const cDir of candidateDirs) {
    if (fsSync.existsSync(cDir)) {
      targetDir = cDir;
      break;
    }
  }

  if (!targetDir) {
    targetDir = path.resolve(projectFilesParent, folderName, "Schemas");
  }
  await fs.mkdir(targetDir, { recursive: true });

  // Clean up legacy single schema files (*_schema_*.yaml)
  try {
    const files = await fs.readdir(targetDir);
    for (const f of files) {
      if (f.includes("_schema_") && (f.endsWith(".yaml") || f.endsWith(".yml"))) {
        await fs.unlink(path.resolve(targetDir, f));
      }
    }
  } catch (e) {
    // ignore
  }

  // Update or create the domain file
  const filesInDir = await fs.readdir(targetDir);
  let domainFileName = filesInDir.find((f) => f.includes("_domain_") && (f.endsWith(".yaml") || f.endsWith(".yml")));
  if (!domainFileName) {
    const timestamp = generateDateTimeStamp();
    domainFileName = `${useCaseSlug}_domain_${timestamp}.yaml`;
  }

  const domainFilePath = path.resolve(targetDir, domainFileName);
  let domainObj: any = {};
  if (fsSync.existsSync(domainFilePath)) {
    try {
      const content = await fs.readFile(domainFilePath, "utf-8");
      domainObj = yaml.load(content) || {};
    } catch (e) {
      domainObj = {};
    }
  } else {
    const domainTemplatePath = resolvePackageFilePath("Domain.yaml");
    if (fsSync.existsSync(domainTemplatePath)) {
      try {
        const content = await fs.readFile(domainTemplatePath, "utf-8");
        domainObj = yaml.load(content) || {};
      } catch (e) {
        domainObj = {};
      }
    }
  }

  if (!domainObj.DomainKnowledge) domainObj.DomainKnowledge = {};
  const dk = domainObj.DomainKnowledge;
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
  domainObj.generatedAt = new Date().toISOString();

  await fs.writeFile(domainFilePath, yaml.dump(domainObj, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[updateOrCreateProjectSchemaFile] Updated domain schema file at ${domainFilePath}`);

  // Update DataIngestion.yaml with mapped fields
  const dataIngestionPath = path.resolve(targetDir, "DataIngestion.yaml");
  let dataIngestionObj: any = { version: "1.0", generatedAt: new Date().toISOString(), resolvedTables: payload.resolvedTables || [], fields: {} };
  if (fsSync.existsSync(dataIngestionPath)) {
    try {
      const content = await fs.readFile(dataIngestionPath, "utf-8");
      dataIngestionObj = yaml.load(content) || dataIngestionObj;
    } catch (e) {
      // use default
    }
  }
  dataIngestionObj.resolvedTables = payload.resolvedTables || [];
  dataIngestionObj.generatedAt = new Date().toISOString();
  if (!dataIngestionObj.fields) dataIngestionObj.fields = {};

  const groupedTopics: Record<string, any[]> = {};
  for (const mapping of payload.mappings || []) {
    const topic = mapping.targetTopic || "General";
    if (!groupedTopics[topic]) groupedTopics[topic] = [];
    if (topic !== "FeatureEngineering") {
      groupedTopics[topic].push({
        field: mapping.datasetField,
        subtype: mapping.subtype || null,
        priority: mapping.priority || "Medium",
        priorityRationale: mapping.priorityRationale || null,
        sensitiveSubtype: mapping.sensitiveSubtype || null,
      });
    }
  }

  for (const [topic, fields] of Object.entries(groupedTopics)) {
    dataIngestionObj.fields[topic] = fields;
  }
  return domainFilePath;
}

export interface ModularSchemaPayload {
  dataIngestionSchema?: {
    version?: string;
    generatedAt?: string;
    resolvedTables?: string[];
    fields?: Record<string, any[]>;
  };
}

/**
 * Resolves the latest existing project run folder timestamp, or returns undefined if none exist.
 */
export function getLatestProjectRunTimestamp(
  workspaceName: string,
  projectName: string
): string | undefined {
  try {
    const packagesDir = getPackagesDir();
    const projectFilesParent = getProjectFilesParent(packagesDir);
    const cleanProjectTitle = sanitizeName(projectName);
    const parentFolderName = resolveProjectFolderName(projectFilesParent, projectName, workspaceName);
    const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
    const parentDir = path.resolve(projectFilesParent, parentFolderName);
    if (fsSync.existsSync(parentDir)) {
      const subEntries = fsSync.readdirSync(parentDir)
        .filter((e) => e.startsWith(`${runSlug}-`))
        .sort((a, b) => b.localeCompare(a));
      if (subEntries.length > 0) {
        const latestFolder = subEntries[0];
        const match = latestFolder.match(/(\d{8}-\d{6})$/);
        if (match) {
          return match[1];
        }
        const parts = latestFolder.split("-");
        if (parts.length >= 3) {
          return parts.slice(parts.length - 2).join("-");
        }
      }
    }
  } catch (err) {
    console.warn("[getLatestProjectRunTimestamp] Warning checking latest run folder:", err);
  }
  return undefined;
}

/**
 * Resolves the unified project run timestamp:
 * 1. If runTimestamp is provided and valid, use it.
 * 2. If not, check if a run folder already exists for this project on disk.
 * 3. Otherwise generate a new timestamp.
 */
export function resolveProjectRunTimestamp(
  workspaceName: string,
  projectName: string,
  runTimestamp?: string
): string {
  if (runTimestamp && runTimestamp.trim().length > 0) {
    return runTimestamp.trim();
  }
  const existingTimestamp = getLatestProjectRunTimestamp(workspaceName, projectName);
  if (existingTimestamp) {
    return existingTimestamp;
  }
  return generateDateTimeStamp();
}

/**
 * Ensures the project run folder exists inside packages/projectFiles/<Project>/<RunSlug>-<Timestamp>/Schemas/
 * and copies any domain knowledge schema from the parent project directory into the run folder so all schemas are unified.
 */
export async function ensureProjectRunFolder(
  workspaceName: string,
  projectName: string,
  runTimestamp: string
): Promise<string> {
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = resolveProjectFolderName(projectFilesParent, projectName, workspaceName);
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);
  const runFolderName = `${runSlug}-${timestamp}`;

  const runSchemasDir = path.resolve(projectFilesParent, parentFolderName, runFolderName, "Schemas");
  await fs.mkdir(runSchemasDir, { recursive: true });

  // Copy domain YAML from parent project schemas if exists
  const candidateParentSchemas = [
    path.resolve(projectFilesParent, parentFolderName, "Schemas"),
    path.resolve(projectFilesParent, cleanProjectTitle, "Schemas"),
    path.resolve(projectFilesParent, `${cleanWsName}-${cleanProjectTitle}`, "Schemas"),
  ];
  for (const parentSchemasDir of candidateParentSchemas) {
    if (fsSync.existsSync(parentSchemasDir)) {
      try {
        const files = await fs.readdir(parentSchemasDir);
        for (const file of files) {
          if (file.includes("_domain_") && (file.endsWith(".yaml") || file.endsWith(".yml"))) {
            const srcFile = path.resolve(parentSchemasDir, file);
            const destFile = path.resolve(runSchemasDir, file);
            if (!fsSync.existsSync(destFile)) {
              await fs.copyFile(srcFile, destFile);
              console.info(`[ensureProjectRunFolder] Copied domain schema ${file} into run folder ${runFolderName}`);
            }
          }
        }
      } catch (copyErr) {
        console.warn(`[ensureProjectRunFolder] Warning copying domain schema:`, copyErr);
      }
    }
  }

  return runSchemasDir;
}

/**
 * Saves resolved Schema Resolver output into modular Data Ingestion YAML file inside
 * packages/projectFiles/<Project>/Schemas/:
 * <usecasetitle>_data_ingestion_<timestamp>.yaml
 */
export async function saveModularResolvedSchemas(
  workspaceName: string,
  projectName: string,
  payload: ModularSchemaPayload,
  runTimestamp?: string
): Promise<{ dataIngestionPath: string }> {
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = resolveProjectFolderName(projectFilesParent, projectName, workspaceName);
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);
  const runFolderName = `${runSlug}-${timestamp}`;

  const targetDir = path.resolve(projectFilesParent, parentFolderName, runFolderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  // Data Ingestion Schema: <usecasetitle>_data_ingestion_<timestamp>.yaml
  const dataIngestionFileName = `${useCaseSlug}_data_ingestion_${timestamp}.yaml`;
  const dataIngestionPath = path.resolve(targetDir, dataIngestionFileName);

  const diData = {
    version: payload.dataIngestionSchema?.version || "1.0",
    generatedAt: payload.dataIngestionSchema?.generatedAt || new Date().toISOString(),
    resolvedTables: payload.dataIngestionSchema?.resolvedTables || [],
    fields: payload.dataIngestionSchema?.fields || {}
  };
  await fs.writeFile(dataIngestionPath, yaml.dump(diData, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[saveModularResolvedSchemas] Saved Data Ingestion schema to ${dataIngestionPath}`);

  return { dataIngestionPath };
}

/**
 * Saves resolved Relationship Schema output into modular Relationship Schema YAML file inside
 * packages/projectFiles/<Project>/Schemas/:
 * <usecasetitle>_relationship_schema_<timestamp>.yaml
 */
export async function saveModularRelationshipSchema(
  workspaceName: string,
  projectName: string,
  relationshipSchemaPayload: any,
  runTimestamp?: string
): Promise<{ relationshipSchemaPath: string }> {
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = resolveProjectFolderName(projectFilesParent, projectName, workspaceName);
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);
  const runFolderName = `${runSlug}-${timestamp}`;

  const targetDir = path.resolve(projectFilesParent, parentFolderName, runFolderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  const relationshipFileName = `${useCaseSlug}_relationship_schema_${timestamp}.yaml`;
  const relationshipSchemaPath = path.resolve(targetDir, relationshipFileName);

  await fs.writeFile(relationshipSchemaPath, yaml.dump(relationshipSchemaPayload, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[saveModularRelationshipSchema] Saved Relationship Schema to ${relationshipSchemaPath}`);

  return { relationshipSchemaPath };
}

/**
 * Saves resolved Form Schema output into modular Form Schema YAML file inside
 * packages/projectFiles/<Project>/<RunFolder>/Schemas/:
 * <usecasetitle>_form_schema_<timestamp>.yaml
 */
export async function saveModularFormSchema(
  workspaceName: string,
  projectName: string,
  formSchemaPayload: any,
  runTimestamp?: string
): Promise<{ formSchemaPath: string }> {
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = resolveProjectFolderName(projectFilesParent, projectName, workspaceName);
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);
  const runFolderName = `${runSlug}-${timestamp}`;

  const targetDir = path.resolve(projectFilesParent, parentFolderName, runFolderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  const formFileName = `${useCaseSlug}_form_schema_${timestamp}.yaml`;
  const formSchemaPath = path.resolve(targetDir, formFileName);

  await fs.writeFile(formSchemaPath, yaml.dump(formSchemaPayload, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[saveModularFormSchema] Saved Form Schema to ${formSchemaPath}`);

  return { formSchemaPath };
}

/**
 * Saves or updates the modular Training Job Contract YAML file inside
 * packages/projectFiles/<Project>/<RunFolder>/Schemas/:
 * <usecasetitle>_training_job_contract_<timestamp>.yaml
 *
 * Copies the TrainingJobContract.yaml template from packages/Schemas,
 * and updates ONLY the model_selection section from the agent response,
 * keeping all other sections untouched.
 */
export async function saveModularTrainingJobContract(
  workspaceName: string,
  projectName: string,
  modelSelectionPayload: any,
  runTimestamp?: string
): Promise<{ trainingJobContractPath: string }> {
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = resolveProjectFolderName(projectFilesParent, projectName, workspaceName);
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);
  const runFolderName = `${runSlug}-${timestamp}`;

  const targetDir = path.resolve(projectFilesParent, parentFolderName, runFolderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  const contractFileName = `${useCaseSlug}_training_job_contract_${timestamp}.yaml`;
  const contractPath = path.resolve(targetDir, contractFileName);

  // Check if an existing contract file already exists in targetDir to preserve other sections
  let baseContent = "";
  if (fsSync.existsSync(contractPath)) {
    baseContent = await fs.readFile(contractPath, "utf-8");
  } else {
    try {
      const existingFiles = await fs.readdir(targetDir);
      const existingContract = existingFiles.find(
        (f) => f.includes("_training_job_contract_") && (f.endsWith(".yaml") || f.endsWith(".yml"))
      );
      if (existingContract) {
        baseContent = await fs.readFile(path.resolve(targetDir, existingContract), "utf-8");
      }
    } catch {}
  }

  // If no existing contract in targetDir, load base template from packages/Schemas
  if (!baseContent) {
    const templatePath = resolvePackageFilePath("TrainingJobContract.yaml");
    if (fsSync.existsSync(templatePath)) {
      baseContent = await fs.readFile(templatePath, "utf-8");
    } else {
      console.warn(`[saveModularTrainingJobContract] Template TrainingJobContract.yaml not found at ${templatePath}`);
      baseContent = "model_selection:\n";
    }
  }

  // Extract decision payload
  const decision = modelSelectionPayload?.decision || modelSelectionPayload?.modelSelection || modelSelectionPayload || {};

  // Build the model_selection structure matching the TrainingJobContract specification
  const modelSelectionData: Record<string, any> = {
    target_entity: {
      name: decision.target_entity?.name ?? null,
      datatype: decision.target_entity?.datatype ?? null,
      description: decision.target_entity?.description ?? null,
      source: decision.target_entity?.source ?? null,
    },
    derivation: decision.derivation ?? null,
    positive_class: decision.positive_class ?? null,
    negative_class: decision.negative_class ?? null,
    prediction_grain: {
      entity: decision.prediction_grain?.entity ?? "record",
      keys: Array.isArray(decision.prediction_grain?.keys) ? decision.prediction_grain.keys : [],
      frequency: decision.prediction_grain?.frequency ?? null,
    },
    recommended_model: decision.recommended_model ? {
      model_id: decision.recommended_model.model_id,
      rank: decision.recommended_model.rank ?? 1,
      suitability_score: decision.recommended_model.suitability_score ?? 1.0,
      recommendation: decision.recommended_model.recommendation ?? "primary",
    } : null,
    candidates: Array.isArray(decision.candidates) ? decision.candidates.map((c: any) => ({
      model_id: c.model_id,
      rank: c.rank,
      suitability_score: c.suitability_score,
      recommendation: c.recommendation || "alternative",
      ...(c.reasoning ? {
        reasoning: {
          strengths: Array.isArray(c.reasoning.strengths) ? c.reasoning.strengths : [],
          weaknesses: Array.isArray(c.reasoning.weaknesses) ? c.reasoning.weaknesses : [],
          suitability: Array.isArray(c.reasoning.suitability) ? c.reasoning.suitability : [],
        },
      } : {}),
    })) : [],
    primary_metric: decision.primary_metric || "RMSE",
    direction: decision.direction || "minimize",
    tie_breakers: Array.isArray(decision.tie_breakers) && decision.tie_breakers.length > 0
      ? decision.tie_breakers
      : ["simplest_model", "fastest_training"],
    constraints: decision.constraints || {},
    selection_strategy: decision.selection_strategy || decision.model_selection_strategy || "top_k_candidates",
    training: {
      mode: decision.training?.mode || "automl_search",
      baseline_model: decision.training?.baseline_model || null,
      ensemble: {
        enabled: Boolean(decision.training?.ensemble?.enabled),
        strategy: decision.training?.ensemble?.strategy || null,
      },
      random_seed: decision.training?.random_seed ?? 42,
      early_stopping: {
        enabled: Boolean(decision.training?.early_stopping?.enabled),
        patience: decision.training?.early_stopping?.patience ?? null,
        metric: decision.training?.early_stopping?.metric || decision.primary_metric || "RMSE",
      },
    },
    max_training_time: decision.max_training_time || null,
    model_selection_strategy: decision.model_selection_strategy || decision.selection_strategy || "highest_validation_score",
    models: Array.isArray(decision.models) && decision.models.length > 0
      ? decision.models.map((m: any) => ({
          model_id: m.model_id,
          framework: m.framework || "custom",
          algorithm: m.algorithm || m.model_id,
          enabled: m.enabled !== undefined ? m.enabled : true,
          parameters: m.parameters || {},
        }))
      : (Array.isArray(decision.candidates) ? decision.candidates.map((c: any) => ({
          model_id: c.model_id,
          framework: c.framework || "custom",
          algorithm: c.algorithm || c.displayName || c.model_id,
          enabled: true,
          parameters: {},
        })) : []),
    ...(Array.isArray(decision.featureRequirements) ? {
      feature_requirements: decision.featureRequirements.map((r: any) => ({
        feature: r.feature || "all",
        requirement: r.requirement || r.desc || "",
        reason: r.reason || "",
      })),
    } : {}),
    ...(decision.hyperparameterOptimization ? {
      hyperparameter_optimization: {
        recommended: Boolean(decision.hyperparameterOptimization.recommended),
        approach: decision.hyperparameterOptimization.approach || "bayesian_optimization",
        rationale: decision.hyperparameterOptimization.rationale || "",
        ...(decision.hyperparameterOptimization.suggestedSearchBudget ? {
          suggested_search_budget: decision.hyperparameterOptimization.suggestedSearchBudget,
        } : {}),
      },
    } : {}),
  };

  // Convert model_selection section to YAML string with 2-space indentation
  const dumpedModelSelection = yaml.dump(
    { model_selection: modelSelectionData },
    { indent: 2, lineWidth: -1, noRefs: true }
  );

  // Replace ONLY the model_selection: block inside baseContent, preserving all other sections and comments
  let updatedYaml: string;
  const startIdx = baseContent.indexOf("model_selection:");
  if (startIdx !== -1) {
    const afterStart = baseContent.substring(startIdx);
    const artifactsHeaderIdx = afterStart.indexOf("# ARTIFACTS");
    let nextSectionIdx = -1;
    if (artifactsHeaderIdx !== -1) {
      nextSectionIdx = afterStart.lastIndexOf("# ---", artifactsHeaderIdx);
      if (nextSectionIdx === -1) {
        nextSectionIdx = artifactsHeaderIdx;
      }
    } else {
      const artifactsMatch = afterStart.match(/\nartifacts:\s*/);
      if (artifactsMatch && artifactsMatch.index !== undefined) {
        nextSectionIdx = artifactsMatch.index + 1;
      }
    }

    if (nextSectionIdx !== -1) {
      const before = baseContent.substring(0, startIdx);
      const after = afterStart.substring(nextSectionIdx);
      updatedYaml = before + dumpedModelSelection.trim() + "\n\n\n" + after;
    } else {
      const nextKeyMatch = afterStart.slice(16).match(/\n[a-zA-Z0-9_-]+:\s*/);
      if (nextKeyMatch && nextKeyMatch.index !== undefined) {
        const before = baseContent.substring(0, startIdx);
        const after = afterStart.substring(16 + nextKeyMatch.index + 1);
        updatedYaml = before + dumpedModelSelection.trim() + "\n\n\n" + after;
      } else {
        updatedYaml = baseContent.substring(0, startIdx) + dumpedModelSelection;
      }
    }
  } else {
    updatedYaml = baseContent.trim() + "\n\n" + dumpedModelSelection;
  }

  await fs.writeFile(contractPath, updatedYaml, "utf-8");
  console.info(`[saveModularTrainingJobContract] Saved Training Job Contract schema to ${contractPath}`);

  // Also copy to parent Schemas dir if it exists
  const parentSchemasDir = path.resolve(projectFilesParent, parentFolderName, "Schemas");
  if (fsSync.existsSync(parentSchemasDir)) {
    try {
      const parentContractPath = path.resolve(parentSchemasDir, contractFileName);
      await fs.writeFile(parentContractPath, updatedYaml, "utf-8");
      console.info(`[saveModularTrainingJobContract] Also copied Training Job Contract to parent Schemas dir: ${parentContractPath}`);
    } catch (parentErr) {
      console.warn(`[saveModularTrainingJobContract] Warning writing to parent schemas dir:`, parentErr);
    }
  }

  return { trainingJobContractPath: contractPath };
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
 * Deletes the project folder inside packages (e.g. packages/projectFiles/<Project> or packages/projectFiles/<Workspace>-<Project>).
 * Ensures all related files inside projectFiles respective to the project are completely deleted.
 */
export async function deleteProjectSchemaFolder(
  workspaceName: string,
  projectName: string
): Promise<boolean> {
  try {
    const packagesDir = getPackagesDir();
    const projectFilesParent = getProjectFilesParent(packagesDir);
    const cleanWsName = sanitizeName(workspaceName);
    const cleanProjectTitle = sanitizeName(projectName);
    const folderName = `${cleanWsName}-${cleanProjectTitle}`;

    const candidateDirs = [
      path.resolve(projectFilesParent, cleanProjectTitle),
      path.resolve(projectFilesParent, folderName),
      path.resolve(packagesDir, "ProjectFiles", cleanProjectTitle),
      path.resolve(packagesDir, "ProjectFiles", folderName),
      path.resolve(packagesDir, cleanProjectTitle),
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

    // Additional scan in projectFilesParent directory for matching folder name
    if (fsSync.existsSync(projectFilesParent)) {
      const entries = await fs.readdir(projectFilesParent);
      for (const entry of entries) {
        const lowerEntry = entry.toLowerCase();
        if (
          lowerEntry === cleanProjectTitle.toLowerCase() ||
          lowerEntry === folderName.toLowerCase() ||
          lowerEntry.endsWith(`-${cleanProjectTitle.toLowerCase()}`)
        ) {
          const entryPath = path.resolve(projectFilesParent, entry);
          if (fsSync.existsSync(entryPath)) {
            await fs.rm(entryPath, { recursive: true, force: true });
            console.info(`[deleteProjectSchemaFolder] Cleaned up matching project folder at ${entryPath}`);
            deletedAny = true;
          }
        }
      }
    }

    return deletedAny;
  } catch (error) {
    console.error(`[deleteProjectSchemaFolder] Error deleting project folder for ${workspaceName}-${projectName}:`, error);
    return false;
  }
}



