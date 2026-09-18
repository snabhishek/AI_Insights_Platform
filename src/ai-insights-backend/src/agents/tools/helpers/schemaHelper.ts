import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  getProjectDir,
  getProjectSchemasDir,
  getLatestProjectTimestamp,
  getWorkspacesBasePath,
} from '../../../config/fileServer.config';

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
 * Resolves the path of existing schema files for a project inside workspaces/<workspace>/projects/<project>/<timestamp>/schemas/
 * or legacy packages/projectFiles/<Project>/Schemas/.
 */
export async function getProjectSchemaDirs(
  workspaceName?: string,
  projectName?: string
): Promise<string[]> {
  if (!workspaceName && !projectName) return [];
  const results: string[] = [];

  // 1. Scan workspaces/<workspace>/projects/<projectName>/<timestamp>/schemas/
  if (workspaceName && projectName) {
    const projectDir = getProjectDir(workspaceName, projectName);
    if (fsSync.existsSync(projectDir)) {
      try {
        const entries = await fs.readdir(projectDir, { withFileTypes: true });
        const timestampDirs = entries
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort((a, b) => b.localeCompare(a)); // Sort latest first

        for (const ts of timestampDirs) {
          const schemaDir = path.resolve(projectDir, ts, "schemas");
          if (fsSync.existsSync(schemaDir) && !results.includes(schemaDir)) {
            results.push(schemaDir);
          }
          const schemaDirUpper = path.resolve(projectDir, ts, "Schemas");
          if (fsSync.existsSync(schemaDirUpper) && !results.includes(schemaDirUpper)) {
            results.push(schemaDirUpper);
          }
        }

        const directSchemas = path.resolve(projectDir, "schemas");
        if (fsSync.existsSync(directSchemas) && !results.includes(directSchemas)) {
          results.push(directSchemas);
        }
      } catch (err) {
        console.warn(`[getProjectSchemaDirs] Warning reading project directory at ${projectDir}:`, err);
      }
    }
  } else if (projectName) {
    const workspacesBase = getWorkspacesBasePath();
    if (fsSync.existsSync(workspacesBase)) {
      try {
        const wsDirs = fsSync.readdirSync(workspacesBase, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const ws of wsDirs) {
          const cand = getProjectDir(ws.name, projectName);
          if (fsSync.existsSync(cand)) {
            const dirs = await getProjectSchemaDirs(ws.name, projectName);
            for (const d of dirs) {
              if (!results.includes(d)) results.push(d);
            }
          }
        }
      } catch {}
    }
  }

  // 2. Legacy fallback to packages/projectFiles/<Project>/Schemas
  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const cleanWsName = workspaceName ? sanitizeName(workspaceName) : "";
  const cleanProjectTitle = projectName ? sanitizeName(projectName) : "";

  const candidateFolderNames: string[] = [];
  if (cleanProjectTitle) candidateFolderNames.push(cleanProjectTitle);
  if (cleanWsName && cleanProjectTitle) candidateFolderNames.push(`${cleanWsName}-${cleanProjectTitle}`);

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
          }
        }
        const directParentSchemas = path.resolve(projectParentDir, "Schemas");
        if (fsSync.existsSync(directParentSchemas) && !results.includes(directParentSchemas)) {
          results.push(directParentSchemas);
        }
      } catch {}
    }
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
 * Creates the initial Domain.yaml modular schema with domain knowledge inside
 * workspaces/<Workspace>/projects/<Project>/<Timestamp>/schemas/<usecasetitle>_domain_<timestamp>.yaml
 */
export async function createProjectSchemaFile(
  workspaceName: string,
  projectInput: ProjectSchemaInput,
  runTimestamp?: string
): Promise<string> {
  const timestamp = runTimestamp && runTimestamp.trim().length > 0 ? runTimestamp.trim() : generateDateTimeStamp();
  const cleanProjectTitle = sanitizeName(projectInput.name);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const domainFileName = `${useCaseSlug}_domain_${timestamp}.yaml`;

  const targetDir = getProjectSchemasDir(workspaceName, projectInput.name, timestamp);
  await fs.mkdir(targetDir, { recursive: true });

  // Load Domain.yaml template from packages/Schemas or codebase
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
 * Searches for modular schema files for the given project.
 * Updates <usecasetitle>_domain_<timestamp>.yaml with domain knowledge and updates modular schemas with resolved mappings.
 */
export async function updateOrCreateProjectSchemaFile(
  workspaceName: string,
  projectTitle: string,
  projectInput: ProjectSchemaInput,
  payload: ResolvedSchemaPayload,
  runTimestamp?: string
): Promise<string> {
  const cleanProjectTitle = sanitizeName(projectTitle);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = resolveProjectRunTimestamp(workspaceName, projectTitle, runTimestamp);

  const targetDir = getProjectSchemasDir(workspaceName, projectTitle, timestamp);
  await fs.mkdir(targetDir, { recursive: true });

  // Update or create the domain file
  const filesInDir = await fs.readdir(targetDir);
  let domainFileName = filesInDir.find((f) => f.includes("_domain_") && (f.endsWith(".yaml") || f.endsWith(".yml")));
  if (!domainFileName) {
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
  const dataIngestionPath = path.resolve(targetDir, `${useCaseSlug}_data_ingestion_${timestamp}.yaml`);
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

  await fs.writeFile(dataIngestionPath, yaml.dump(dataIngestionObj, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
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
  const fromConfig = getLatestProjectTimestamp(workspaceName, projectName);
  if (fromConfig) return fromConfig;

  // Legacy fallback check
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
        const match = latestFolder.match(/(\d{8}[-_]\d{6})$/);
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
    console.warn("[getLatestProjectRunTimestamp] Warning checking legacy run folder:", err);
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
 * Ensures the project run folder exists inside workspaces/<Workspace>/projects/<Project>/<Timestamp>/schemas/
 * without copying old domain schemas from past runs.
 */
export async function ensureProjectRunFolder(
  workspaceName: string,
  projectName: string,
  runTimestamp: string
): Promise<string> {
  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);
  const runSchemasDir = getProjectSchemasDir(workspaceName, projectName, timestamp);
  await fs.mkdir(runSchemasDir, { recursive: true });
  return runSchemasDir;
}

/**
 * Saves resolved Schema Resolver output into modular Data Ingestion YAML file inside
 * workspaces/<Workspace>/projects/<Project>/<Timestamp>/schemas/:
 * <usecasetitle>_data_ingestion_<timestamp>.yaml
 */
export async function saveModularResolvedSchemas(
  workspaceName: string,
  projectName: string,
  payload: ModularSchemaPayload,
  runTimestamp?: string
): Promise<{ dataIngestionPath: string }> {
  const cleanProjectTitle = sanitizeName(projectName);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);

  const targetDir = getProjectSchemasDir(workspaceName, projectName, timestamp);
  await fs.mkdir(targetDir, { recursive: true });

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
 * workspaces/<Workspace>/projects/<Project>/<Timestamp>/schemas/:
 * <usecasetitle>_relationship_schema_<timestamp>.yaml
 */
export async function saveModularRelationshipSchema(
  workspaceName: string,
  projectName: string,
  relationshipSchemaPayload: any,
  runTimestamp?: string
): Promise<{ relationshipSchemaPath: string }> {
  const cleanProjectTitle = sanitizeName(projectName);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);

  const targetDir = getProjectSchemasDir(workspaceName, projectName, timestamp);
  await fs.mkdir(targetDir, { recursive: true });

  const relationshipFileName = `${useCaseSlug}_relationship_schema_${timestamp}.yaml`;
  const relationshipSchemaPath = path.resolve(targetDir, relationshipFileName);

  await fs.writeFile(relationshipSchemaPath, yaml.dump(relationshipSchemaPayload, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[saveModularRelationshipSchema] Saved Relationship Schema to ${relationshipSchemaPath}`);

  return { relationshipSchemaPath };
}

/**
 * Saves resolved Form Schema output into modular Form Schema YAML file inside
 * workspaces/<Workspace>/projects/<Project>/<Timestamp>/schemas/:
 * <usecasetitle>_form_schema_<timestamp>.yaml
 */
export async function saveModularFormSchema(
  workspaceName: string,
  projectName: string,
  formSchemaPayload: any,
  runTimestamp?: string
): Promise<{ formSchemaPath: string }> {
  const cleanProjectTitle = sanitizeName(projectName);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);

  const targetDir = getProjectSchemasDir(workspaceName, projectName, timestamp);
  await fs.mkdir(targetDir, { recursive: true });

  const formFileName = `${useCaseSlug}_form_schema_${timestamp}.yaml`;
  const formSchemaPath = path.resolve(targetDir, formFileName);

  await fs.writeFile(formSchemaPath, yaml.dump(formSchemaPayload, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[saveModularFormSchema] Saved Form Schema to ${formSchemaPath}`);

  return { formSchemaPath };
}

/**
 * Saves or updates the modular Training Job Contract YAML file inside
 * workspaces/<Workspace>/projects/<Project>/<Timestamp>/schemas/:
 * <usecasetitle>_training_job_contract_<timestamp>.yaml
 */
/**
 * Comment headers preserving the exact structure and documentation from TrainingJobContract schema.
 */
export const TRAINING_JOB_CONTRACT_COMMENTS = {
  HEADER: `# =============================================================================
# TRAINING JOB CONTRACT — AutoML Platform
# Scope: AGENT TRAINING ONLY.
#
# Dataset ingestion, data understanding, profiling, feature engineering,
# feature selection, and preprocessing are handled by upstream agents.
# This contract consumes their finalized outputs through upstream_artifacts.
#
# The training agent uses this contract to:
# 1. Understand the ML problem.
# 2. Select/validate the training strategy.
# 3. Train candidate models.
# 4. Optimize hyperparameters.
# 5. Evaluate and select the best model.
#
# Every field should contain either a concrete value or an explicit null when
# it is not applicable.
# =============================================================================`,

  PRIMARY_METRIC: `# -----------------------------------------------------------------------------
# PRIMARY METRIC
# -----------------------------------------------------------------------------
# Single source of truth for the metric used throughout training, optimization,
# evaluation, and model selection. The same definition must not be duplicated.
# -----------------------------------------------------------------------------`,

  TRAINING_JOB: `# -----------------------------------------------------------------------------
# TRAINING JOB
# -----------------------------------------------------------------------------`,

  ML_TASK: `# -----------------------------------------------------------------------------
# ML TASK
# -----------------------------------------------------------------------------`,

  UPSTREAM_ARTIFACTS: `# -----------------------------------------------------------------------------
# UPSTREAM ARTIFACTS
# -----------------------------------------------------------------------------
# References finalized outputs from upstream agents.
# These are identifiers, not definitions of those artifacts.
# -----------------------------------------------------------------------------`,

  DATA_SPLITTING: `# -----------------------------------------------------------------------------
# DATA SPLITTING
# -----------------------------------------------------------------------------`,

  CLASS_IMBALANCE: `# -----------------------------------------------------------------------------
# CLASS IMBALANCE
# -----------------------------------------------------------------------------`,

  HYPERPARAMETER_OPTIMIZATION: `# -----------------------------------------------------------------------------
# HYPERPARAMETER OPTIMIZATION
# -----------------------------------------------------------------------------`,

  SEARCH_SPACE: `# -----------------------------------------------------------------------------
# SEARCH SPACE
# -----------------------------------------------------------------------------
# Generic representation used by the training engine. The actual parameters
# depend on the selected model family.
# -----------------------------------------------------------------------------`,

  TRAINING_OBJECTIVE: `# -----------------------------------------------------------------------------
# TRAINING OBJECTIVE
# -----------------------------------------------------------------------------`,

  EVALUATION: `# -----------------------------------------------------------------------------
# EVALUATION
# -----------------------------------------------------------------------------`,

  THRESHOLD_OPTIMIZATION: `# -----------------------------------------------------------------------------
# THRESHOLD OPTIMIZATION
# -----------------------------------------------------------------------------
# Applicable primarily to classification models producing probabilities or
# scores that must be converted into business decisions.
# -----------------------------------------------------------------------------`,

  VALIDATION_GATES: `# -----------------------------------------------------------------------------
# VALIDATION GATES
# -----------------------------------------------------------------------------
# Hard requirements that a trained model must satisfy before it can be
# considered a successful training result.
# -----------------------------------------------------------------------------`,

  MODEL_SELECTION: `# -----------------------------------------------------------------------------
# MODEL SELECTION
# -----------------------------------------------------------------------------
# Determines which candidate becomes the final model after all candidates
# have been trained and evaluated.
# -----------------------------------------------------------------------------`,

  ARTIFACTS: `# -----------------------------------------------------------------------------
# ARTIFACTS
# -----------------------------------------------------------------------------`,
};

function dumpSectionYaml(data: Record<string, any>): string {
  return yaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }).trim();
}

/**
 * Saves or updates the modular Training Job Contract YAML file inside
 * workspaces/<Workspace>/projects/<Project>/<Timestamp>/schemas/:
 * <usecasetitle>_training_job_contract_<timestamp>.yaml
 *
 * Formats the YAML content between the standard comment section headers for both
 * Model Selection and Training Configuration agents.
 */
export async function saveModularTrainingJobContract(
  workspaceName: string,
  projectName: string,
  payload: any,
  runTimestamp?: string
): Promise<{ trainingJobContractPath: string; contractPath: string }> {
  const cleanProjectTitle = sanitizeName(projectName);
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = resolveProjectRunTimestamp(workspaceName, projectName, runTimestamp);

  const targetDir = getProjectSchemasDir(workspaceName, projectName, timestamp);
  await fs.mkdir(targetDir, { recursive: true });

  const contractFileName = `${useCaseSlug}_training_job_contract_${timestamp}.yaml`;
  const contractPath = path.resolve(targetDir, contractFileName);

  // 1. Read existing contract file if present to preserve/merge data
  let existingObj: Record<string, any> = {};
  if (fsSync.existsSync(contractPath)) {
    try {
      const content = await fs.readFile(contractPath, "utf-8");
      existingObj = (yaml.load(content) as Record<string, any>) || {};
    } catch {}
  } else {
    try {
      const existingFiles = await fs.readdir(targetDir);
      const existingContract = existingFiles.find(
        (f) => f.includes("_training_job_contract_") && (f.endsWith(".yaml") || f.endsWith(".yml"))
      );
      if (existingContract) {
        const content = await fs.readFile(path.resolve(targetDir, existingContract), "utf-8");
        existingObj = (yaml.load(content) as Record<string, any>) || {};
      }
    } catch {}
  }

  // Unwrap config/decision if nested
  const rawData = payload?.configuration || payload?.decision || payload?.modelSelection || payload || {};

  // Check if incoming payload is a full training configuration
  const isTrainingConfig = Boolean(
    rawData.task || rawData.split || rawData.search_space || rawData.objective || rawData.training_job || payload?.configuration
  );

  // Determine primary metric name and definition
  const primaryMetricName =
    rawData["x-primary-metric-name"] ||
    rawData.primary_metric_name ||
    rawData.primary_metric ||
    existingObj["x-primary-metric-name"] ||
    existingObj.primary_metric_name ||
    existingObj.model_selection?.primary_metric ||
    "f1_score";

  const primaryMetricDef =
    rawData["x-primary-metric-def"] ||
    rawData.primary_metric_def ||
    existingObj["x-primary-metric-def"] ||
    existingObj.primary_metric_def || {
      value: primaryMetricName,
      source: "llm_inference",
      confidence: 0.95,
      confirmation_threshold: 0.85,
      requires_confirmation: false,
      rationale: "Selected primary metric representing business goal",
      evidence: [],
    };

  // Build model_selection data (merging candidates/models with training steps)
  const existingModelSel = existingObj.model_selection || {};
  const incomingModelSel = rawData.model_selection || (isTrainingConfig ? {} : rawData);

  let mergedCandidates: any[] = [];
  const candidateMap = new Map<string, any>();
  for (const c of (existingModelSel.candidates || [])) {
    if (c.model_id) candidateMap.set(c.model_id, { ...c });
  }
  for (const c of (incomingModelSel.candidates || [])) {
    if (c.model_id) {
      const prev = candidateMap.get(c.model_id) || {};
      candidateMap.set(c.model_id, {
        ...prev,
        ...c,
        ...(c.training_steps ? { training_steps: c.training_steps } : (prev.training_steps ? { training_steps: prev.training_steps } : {})),
      });
    }
  }
  if (candidateMap.size > 0) {
    mergedCandidates = Array.from(candidateMap.values());
  }

  let mergedModels: any[] = [];
  const modelMap = new Map<string, any>();
  for (const m of (existingModelSel.models || [])) {
    if (m.model_id) modelMap.set(m.model_id, { ...m });
  }
  for (const m of (incomingModelSel.models || [])) {
    if (m.model_id) {
      const prev = modelMap.get(m.model_id) || {};
      modelMap.set(m.model_id, {
        ...prev,
        ...m,
        ...(m.training_steps ? { training_steps: m.training_steps } : (prev.training_steps ? { training_steps: prev.training_steps } : {})),
      });
    }
  }
  if (modelMap.size > 0) {
    mergedModels = Array.from(modelMap.values());
  }

  const modelSelectionData: Record<string, any> = {
    target_entity: incomingModelSel.target_entity ?? existingModelSel.target_entity ?? {
      name: incomingModelSel.targetColumn || null,
      datatype: null,
      description: null,
      source: null,
    },
    derivation: incomingModelSel.derivation ?? existingModelSel.derivation ?? null,
    positive_class: incomingModelSel.positive_class ?? existingModelSel.positive_class ?? null,
    negative_class: incomingModelSel.negative_class ?? existingModelSel.negative_class ?? null,
    prediction_grain: incomingModelSel.prediction_grain ?? existingModelSel.prediction_grain ?? {
      entity: "record",
      keys: [],
      frequency: null,
    },
    recommended_model: incomingModelSel.recommended_model ?? existingModelSel.recommended_model ?? null,
    candidates: mergedCandidates.length > 0 ? mergedCandidates : (incomingModelSel.candidates || []),
    primary_metric: primaryMetricName,
    direction: incomingModelSel.direction ?? existingModelSel.direction ?? "maximize",
    tie_breakers: incomingModelSel.tie_breakers ?? existingModelSel.tie_breakers ?? ["simplest_model", "fastest_training"],
    constraints: incomingModelSel.constraints ?? existingModelSel.constraints ?? {},
    selection_strategy: incomingModelSel.selection_strategy ?? existingModelSel.selection_strategy ?? "top_k_candidates",
    training: incomingModelSel.training ?? existingModelSel.training ?? {
      mode: "automl_search",
      baseline_model: null,
      ensemble: { enabled: false, strategy: null },
      random_seed: 42,
      early_stopping: { enabled: false, patience: null, metric: primaryMetricName },
    },
    max_training_time: incomingModelSel.max_training_time ?? existingModelSel.max_training_time ?? null,
    model_selection_strategy: incomingModelSel.model_selection_strategy ?? existingModelSel.model_selection_strategy ?? "highest_validation_score",
    models: mergedModels.length > 0 ? mergedModels : (incomingModelSel.models || []),
    ...(incomingModelSel.feature_requirements || incomingModelSel.featureRequirements ? {
      feature_requirements: incomingModelSel.feature_requirements || incomingModelSel.featureRequirements,
    } : (existingModelSel.feature_requirements ? { feature_requirements: existingModelSel.feature_requirements } : {})),
    ...(incomingModelSel.hyperparameter_optimization || incomingModelSel.hyperparameterOptimization ? {
      hyperparameter_optimization: incomingModelSel.hyperparameter_optimization || incomingModelSel.hyperparameterOptimization,
    } : (existingModelSel.hyperparameter_optimization ? { hyperparameter_optimization: existingModelSel.hyperparameter_optimization } : {})),
  };

  // Assemble remaining sections from rawData (if training config) or existingObj / defaults
  const trainingJobData = rawData.training_job || existingObj.training_job || {
    job_id: `${cleanProjectTitle}_training_${timestamp}`,
    experiment_name: cleanProjectTitle,
    version: "1.0.0",
    created_at: new Date().toISOString(),
    created_by: "AutoML Platform",
    description: `Training pipeline contract for ${cleanProjectTitle}`,
  };

  const taskData = rawData.task || existingObj.task || {
    task_type: rawData.problemType || existingObj.task?.task_type || "classification",
    task_subtype: rawData.problemType === "regression" ? "single" : "binary",
    learning_type: "supervised",
    prediction_type: rawData.problemType === "regression" ? "value" : "label",
    prediction_horizon: null,
    prediction_timestamp: null,
  };

  const upstreamArtifactsData = rawData.upstream_artifacts || existingObj.upstream_artifacts || {
    dataset_id: `dataset_${cleanProjectTitle}_${timestamp}`,
    dataset_version: "1.0",
    feature_set_id: `features_${cleanProjectTitle}_${timestamp}`,
    feature_set_version: "1.0",
    profiling_report_id: `profiling_${cleanProjectTitle}_${timestamp}`,
    relationship_schema_id: null,
    row_count: 0,
    column_count: 0,
  };

  const splitData = rawData.split || existingObj.split || {
    strategy: "random",
    train_ratio: 0.7,
    validation_ratio: 0.15,
    test_ratio: 0.15,
    random_seed: 42,
    stratify_by: null,
    group_by: null,
    time_column: null,
    temporal: {
      train_start: null,
      train_end: null,
      validation_start: null,
      validation_end: null,
      test_start: null,
      test_end: null,
    },
    cross_validation: {
      enabled: false,
      strategy: "kfold",
      folds: 0,
      shuffle: false,
      random_seed: 42,
    },
  };

  const imbalanceData = rawData.imbalance || existingObj.imbalance || {
    detected: false,
    ratio: null,
    strategy: "none",
    class_weights: "none",
    sampling: {
      method: "none",
      sampling_ratio: null,
    },
  };

  const hpoData = rawData.hyperparameter_optimization || existingObj.hyperparameter_optimization || {
    enabled: false,
    method: "bayesian",
    objective_metric: primaryMetricName,
    direction: "maximize",
    max_trials: 0,
    timeout: null,
    search_space: {},
    pruning: {
      enabled: false,
    },
  };

  const searchSpaceData = rawData.search_space || existingObj.search_space || {};

  const objectiveData = rawData.objective || existingObj.objective || {
    training_loss: rawData.problemType === "regression" ? "mse" : "logloss",
    optimization_metric: primaryMetricName,
    direction: "maximize",
    custom_objective: {
      enabled: false,
      definition: null,
    },
  };

  const evaluationData = rawData.evaluation || existingObj.evaluation || {
    primary_metric: primaryMetricDef,
    secondary_metrics: rawData.problemType === "regression" ? ["MAE", "RMSE", "R2"] : ["accuracy", "precision", "recall", "roc_auc"],
    thresholds: {
      primary_metric_min: null,
      secondary_metric_constraints: {},
    },
    segment_analysis: [],
    confidence_intervals: {
      enabled: false,
    },
    bootstrap: {
      enabled: false,
      samples: null,
    },
    fairness_scope: {
      protected_attributes: [],
      metric: null,
      max_disparity: null,
    },
  };

  const thresholdingData = rawData.thresholding || existingObj.thresholding || {
    enabled: false,
    default_threshold: null,
    optimization: {
      enabled: false,
      metric: null,
      constraints: {},
    },
  };

  const validationGatesData = rawData.validation_gates || existingObj.validation_gates || {
    minimum_primary_metric: null,
    maximum_overfitting_gap: null,
    maximum_latency: null,
    maximum_model_size: null,
    fairness_requirements: null,
    data_quality_requirements: {
      max_null_rate: null,
      schema_match: "strict",
    },
    calibration_requirement: {
      method: "none",
      max_calibration_error: null,
    },
    stability_requirement: {
      metric_variance_across_folds_max: null,
    },
    pass_condition: "all_gates_must_pass",
  };

  const artifactsData = rawData.artifacts || existingObj.artifacts || {
    output_path: `/workspace/${timestamp}/python_script`,
    save: {
      model: true,
      metrics: true,
      predictions: false,
      explainability: false,
      training_config: true,
    },
    serialization_format: "onnx",
    explainability_method: "none",
  };

  // 2. Format the complete document between the exact comment headers from TrainingJobContract schema
  const formattedYaml = [
    TRAINING_JOB_CONTRACT_COMMENTS.HEADER,
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.PRIMARY_METRIC,
    "",
    dumpSectionYaml({
      "x-primary-metric-name": primaryMetricName,
      "x-primary-metric-def": primaryMetricDef,
    }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.TRAINING_JOB,
    "",
    dumpSectionYaml({ training_job: trainingJobData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.ML_TASK,
    "",
    dumpSectionYaml({ task: taskData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.UPSTREAM_ARTIFACTS,
    "",
    dumpSectionYaml({ upstream_artifacts: upstreamArtifactsData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.DATA_SPLITTING,
    "",
    dumpSectionYaml({ split: splitData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.CLASS_IMBALANCE,
    "",
    dumpSectionYaml({ imbalance: imbalanceData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.HYPERPARAMETER_OPTIMIZATION,
    "",
    dumpSectionYaml({ hyperparameter_optimization: hpoData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.SEARCH_SPACE,
    "",
    dumpSectionYaml({ search_space: searchSpaceData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.TRAINING_OBJECTIVE,
    "",
    dumpSectionYaml({ objective: objectiveData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.EVALUATION,
    "",
    dumpSectionYaml({ evaluation: evaluationData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.THRESHOLD_OPTIMIZATION,
    "",
    dumpSectionYaml({ thresholding: thresholdingData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.VALIDATION_GATES,
    "",
    dumpSectionYaml({ validation_gates: validationGatesData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.MODEL_SELECTION,
    "",
    dumpSectionYaml({ model_selection: modelSelectionData }),
    "",
    "",
    TRAINING_JOB_CONTRACT_COMMENTS.ARTIFACTS,
    "",
    dumpSectionYaml({ artifacts: artifactsData }),
    "",
  ].join("\n");

  await fs.writeFile(contractPath, formattedYaml, "utf-8");
  console.info(`[saveModularTrainingJobContract] Successfully saved Training Job Contract schema to ${contractPath}`);

  return { trainingJobContractPath: contractPath, contractPath };
}

export const saveModularTrainingConfigContract = saveModularTrainingJobContract;


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
    if (workspaceName && projectName) {
      const projectDir = getProjectDir(workspaceName, projectName);
      if (fsSync.existsSync(projectDir)) {
        await fs.rm(projectDir, { recursive: true, force: true });
        console.info(`[deleteProjectSchemaFolder] Deleted project directory at ${projectDir}`);
        deletedAny = true;
      }
    }

    let deletedAnyLegacy = false;
    for (const dir of candidateDirs) {
      if (fsSync.existsSync(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
        console.info(`[deleteProjectSchemaFolder] Deleted legacy project folder at ${dir}`);
        deletedAnyLegacy = true;
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



