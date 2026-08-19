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
  const packagesDir = getPackagesDir();
  const candidatePaths = [
    path.join(packagesDir, "Schemas", filename),
    path.join(packagesDir, filename),
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
 * Resolves the path of an existing schema file for a project inside packages/ProjectFiles/<Workspace>-<Project>/Schemas/.
 */
export async function getProjectSchemaDirs(
  workspaceName?: string,
  projectName?: string
): Promise<string[]> {
  if (!workspaceName || !projectName) return [];
  const packagesDir = getPackagesDir();
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = `${cleanWsName}-${cleanProjectTitle}`;
  const projectFilesParent = path.resolve(packagesDir, "ProjectFiles");

  const results: string[] = [];

  // 1. Scan nested run subfolders inside ProjectFiles/<Workspace>-<Project>/
  const projectParentDir = path.resolve(projectFilesParent, parentFolderName);
  if (fsSync.existsSync(projectParentDir)) {
    try {
      const subEntries = await fs.readdir(projectParentDir);
      const sortedSubEntries = subEntries.sort((a, b) => b.localeCompare(a));
      for (const subEntry of sortedSubEntries) {
        const subSchemaDir = path.resolve(projectParentDir, subEntry, "Schemas");
        if (fsSync.existsSync(subSchemaDir)) {
          results.push(subSchemaDir);
        } else {
          const directSubDir = path.resolve(projectParentDir, subEntry);
          if (fsSync.existsSync(directSubDir) && fsSync.statSync(directSubDir).isDirectory()) {
            results.push(directSubDir);
          }
        }
      }

      // Check legacy Schemas directly under main project dir
      const directParentSchemas = path.resolve(projectParentDir, "Schemas");
      if (fsSync.existsSync(directParentSchemas) && !results.includes(directParentSchemas)) {
        results.push(directParentSchemas);
      }
    } catch {}
  }

  // 2. Scan legacy flat directories matching ProjectFiles/<Workspace>-<Project>_*
  if (fsSync.existsSync(projectFilesParent)) {
    try {
      const entries = await fs.readdir(projectFilesParent);
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
 * Creates the project folder inside packages/ProjectFiles/<Workspace>-<Project>/Schemas
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
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectInput.name);
  const folderName = `${cleanWsName}-${cleanProjectTitle}`;
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");
  const timestamp = generateDateTimeStamp();
  const domainFileName = `${useCaseSlug}_domain_${timestamp}.yaml`;

  const targetDir = path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas");
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
 * Searches for modular schema files under packages/ProjectFiles for the given project folder convention.
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
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectTitle);
  const folderName = `${cleanWsName}-${cleanProjectTitle}`;
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const candidateDirs = [
    path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas"),
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
    targetDir = path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas");
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
 * Saves resolved Schema Resolver output into modular Data Ingestion YAML file inside
 * packages/ProjectFiles/<Workspace>-<Project>/Schemas/:
 * <usecasetitle>_data_ingestion_<timestamp>.yaml
 */
export async function saveModularResolvedSchemas(
  workspaceName: string,
  projectName: string,
  payload: ModularSchemaPayload,
  runTimestamp?: string
): Promise<{ dataIngestionPath: string }> {
  const packagesDir = getPackagesDir();
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = `${cleanWsName}-${cleanProjectTitle}`;
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const timestamp = (runTimestamp && runTimestamp.trim().length > 0) ? runTimestamp.trim() : generateDateTimeStamp();
  const runFolderName = `${runSlug}-${timestamp}`;

  const targetDir = path.resolve(packagesDir, "ProjectFiles", parentFolderName, runFolderName, "Schemas");
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
 * packages/ProjectFiles/<Workspace>-<Project>/Schemas/:
 * <usecasetitle>_relationship_schema_<timestamp>.yaml
 */
export async function saveModularRelationshipSchema(
  workspaceName: string,
  projectName: string,
  relationshipSchemaPayload: any,
  runTimestamp?: string
): Promise<{ relationshipSchemaPath: string }> {
  const packagesDir = getPackagesDir();
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = `${cleanWsName}-${cleanProjectTitle}`;
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const timestamp = (runTimestamp && runTimestamp.trim().length > 0) ? runTimestamp.trim() : generateDateTimeStamp();
  const runFolderName = `${runSlug}-${timestamp}`;

  const targetDir = path.resolve(packagesDir, "ProjectFiles", parentFolderName, runFolderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  const relationshipFileName = `${useCaseSlug}_relationship_schema_${timestamp}.yaml`;
  const relationshipSchemaPath = path.resolve(targetDir, relationshipFileName);

  await fs.writeFile(relationshipSchemaPath, yaml.dump(relationshipSchemaPayload, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[saveModularRelationshipSchema] Saved Relationship Schema to ${relationshipSchemaPath}`);

  return { relationshipSchemaPath };
}

/**
 * Saves resolved Form Schema output into modular Form Schema YAML file inside
 * packages/ProjectFiles/<Workspace>-<Project>/<RunFolder>/Schemas/:
 * <usecasetitle>_form_schema_<timestamp>.yaml
 */
export async function saveModularFormSchema(
  workspaceName: string,
  projectName: string,
  formSchemaPayload: any,
  runTimestamp?: string
): Promise<{ formSchemaPath: string }> {
  const packagesDir = getPackagesDir();
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjectTitle = sanitizeName(projectName);
  const parentFolderName = `${cleanWsName}-${cleanProjectTitle}`;
  const runSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjectTitle.toLowerCase().replace(/[\s-]+/g, "_");

  const timestamp = (runTimestamp && runTimestamp.trim().length > 0) ? runTimestamp.trim() : generateDateTimeStamp();
  const runFolderName = `${runSlug}-${timestamp}`;

  const targetDir = path.resolve(packagesDir, "ProjectFiles", parentFolderName, runFolderName, "Schemas");
  await fs.mkdir(targetDir, { recursive: true });

  const formFileName = `${useCaseSlug}_form_schema_${timestamp}.yaml`;
  const formSchemaPath = path.resolve(targetDir, formFileName);

  await fs.writeFile(formSchemaPath, yaml.dump(formSchemaPayload, { indent: 2, lineWidth: -1, noRefs: true }), "utf-8");
  console.info(`[saveModularFormSchema] Saved Form Schema to ${formSchemaPath}`);

  return { formSchemaPath };
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
 * Ensures all related files inside ProjectFiles respective to the project are completely deleted.
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

    // Additional scan in ProjectFiles directory for matching folder name (case-insensitive or normalized)
    const projectFilesParent = path.resolve(packagesDir, "ProjectFiles");
    if (fsSync.existsSync(projectFilesParent)) {
      const entries = await fs.readdir(projectFilesParent);
      for (const entry of entries) {
        const lowerEntry = entry.toLowerCase();
        if (
          lowerEntry === folderName.toLowerCase() ||
          lowerEntry.endsWith(`-${cleanProjectTitle.toLowerCase()}`) ||
          lowerEntry === cleanProjectTitle.toLowerCase()
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



