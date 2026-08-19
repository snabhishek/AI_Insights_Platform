import { RelationshipSchemaOutput, RelationshipNode, HierarchyRelationship, ConformedGroup } from "./state";
import { IGenericDataConnector } from "./dataConnector";

export interface AnalyzeDependenciesInput {
  connector?: IGenericDataConnector;
  projectId?: string;
  userPrompt?: string;
  schemaResolution?: Record<string, unknown>;
  inspection?: Record<string, unknown>;
  tableNames?: string[];
  connectorType?: string;
}

/**
 * High-performance Relationship Builder Engine
 * Discovers real hierarchical relationships across tables/files via generic data connector functions
 * without pulling raw row data into LLM context.
 */
export async function analyzeFunctionalDependenciesTool(
  input: AnalyzeDependenciesInput
): Promise<RelationshipSchemaOutput> {
  const connector = input.connector;
  const sourceType = input.connectorType || "database";
  const datasetId = input.projectId || "default_dataset";

  const nodes: RelationshipNode[] = [];
  const relationships: HierarchyRelationship[] = [];
  const conformedGroups: ConformedGroup[] = [];

  // Extract columns & roles from schema resolution or inspection state
  const schemaFields = (input.schemaResolution as any)?.dataIngestionSchema?.fields || {};
  const inspectionTables = (input.inspection as any)?.tables || [];

  interface ColumnCandidate {
    tableName: string;
    originalName: string;
    role: "identifier" | "categorical" | "location" | "temporal";
    priority: string;
    entityScope: string;
  }

  const candidates: ColumnCandidate[] = [];

  // Step 1: Scope work
  // Filter for Identifier, Categorical, Location, and Critical Temporal columns only.
  for (const [catName, fieldList] of Object.entries(schemaFields)) {
    if (!Array.isArray(fieldList)) continue;

    const lowerCat = catName.toLowerCase();
    let role: "identifier" | "categorical" | "location" | "temporal" | null = null;
    if (lowerCat.includes("identifier")) role = "identifier";
    else if (lowerCat.includes("categorical")) role = "categorical";
    else if (lowerCat.includes("location")) role = "location";
    else if (lowerCat.includes("temporal")) role = "temporal";

    for (const f of fieldList) {
      if (typeof f !== "object" || !f) continue;
      const fieldName = f.field || f.technicalName || f.name;
      if (!fieldName) continue;

      const priority = (f.priority || "Medium").toLowerCase();
      if (role === "temporal" && priority !== "critical" && priority !== "high") {
        continue; // Ignore non-critical temporal
      }

      if (role) {
        const parts = String(fieldName).split(".");
        const table = parts.length > 1 ? parts[0] : (input.tableNames?.[0] || "default_table");
        const col = parts.length > 1 ? parts[1] : parts[0];

        // Derive entityScope from column prefix or table name
        const prefix = col.includes("_") ? col.split("_")[0] : table;
        const entityScope = prefix.toLowerCase();

        candidates.push({
          tableName: table,
          originalName: col,
          role,
          priority: f.priority || "Medium",
          entityScope,
        });
      }
    }
  }

  // Fallback candidates if schemaResolution was empty
  if (candidates.length === 0 && inspectionTables.length > 0) {
    for (const t of inspectionTables) {
      const tableName = t.tableName || t.name || "table";
      for (const c of t.columns || []) {
        const colName = c.technicalName || c.name;
        const lowerType = String(c.dataType || "").toLowerCase();
        const isKey = c.constraints?.includes("PK") || c.constraints?.includes("FK") || c.candidateBusinessKey === "YES";

        let role: "identifier" | "categorical" | "location" | "temporal" | null = null;
        if (isKey || colName.toLowerCase().endsWith("id") || colName.toLowerCase().endsWith("code")) role = "identifier";
        else if (colName.toLowerCase().includes("country") || colName.toLowerCase().includes("region") || colName.toLowerCase().includes("city") || colName.toLowerCase().includes("state")) role = "location";
        else if (lowerType.includes("date") || lowerType.includes("time") || colName.toLowerCase().includes("year") || colName.toLowerCase().includes("month")) role = "temporal";
        else if (lowerType.includes("char") || lowerType.includes("text") || lowerType.includes("varchar")) role = "categorical";

        if (role) {
          const prefix = colName.includes("_") ? colName.split("_")[0] : tableName;
          candidates.push({
            tableName,
            originalName: colName,
            role,
            priority: c.businessImportance || "Medium",
            entityScope: prefix.toLowerCase(),
          });
        }
      }
    }
  }

  // Step 2 & 3: Merge aliases & Group by entity scope
  const aliasMap = new Map<string, string[]>(); // canonicalId -> [colNames]

  for (const cand of candidates) {
    const canonicalId = `${cand.entityScope}_${cand.originalName}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    
    // Check cardinality if connector is provided
    let cardinality = 0;
    let sampleValues: string[] = [];
    if (connector) {
      cardinality = await connector.getFieldCardinality(cand.originalName, cand.tableName);
      if (cardinality > 0 && cardinality <= 20) {
        sampleValues = await connector.getValueSet(cand.originalName, 5, cand.tableName);
      }
    }

    nodes.push({
      id: canonicalId,
      aliasOf: [cand.originalName],
      role: cand.role,
      entityScope: cand.entityScope,
      cardinality: cardinality || 10,
      sampleValues,
    });
  }

  // Step 4: Test each candidate pair within the same entity scope for hierarchies
  const entityGroups = new Map<string, RelationshipNode[]>();
  for (const node of nodes) {
    if (!entityGroups.has(node.entityScope)) {
      entityGroups.set(node.entityScope, []);
    }
    entityGroups.get(node.entityScope)!.push(node);
  }

  for (const [entityScope, scopeNodes] of entityGroups.entries()) {
    for (let i = 0; i < scopeNodes.length; i++) {
      for (let j = 0; j < scopeNodes.length; j++) {
        if (i === j) continue;
        const parentNode = scopeNodes[i];
        const childNode = scopeNodes[j];

        // Only test if parent has lower or equal cardinality than child (higher level of hierarchy)
        if (parentNode.cardinality > 0 && childNode.cardinality > 0 && parentNode.cardinality >= childNode.cardinality) {
          continue;
        }

        let purity = 1.0;
        let sampleSize = 1000;

        if (connector) {
          const stats = await connector.getDependencyStats(parentNode.aliasOf[0], childNode.aliasOf[0]);
          purity = stats.purity;
          sampleSize = stats.sampleSize;
        }

        if (purity >= 0.90) {
          const relType = parentNode.role === "location" || childNode.role === "location"
            ? "geographic_hierarchy"
            : "strict_hierarchy";

          relationships.push({
            parent: parentNode.id,
            child: childNode.id,
            type: relType,
            evidence: {
              method: "dependency_stats",
              sourceType,
              purity,
              sampleSize,
            },
            confidence: Number(purity.toFixed(2)),
            businessLabel: `${parentNode.id.replace(/_/g, " ")} determines ${childNode.id.replace(/_/g, " ")}`,
            priority: parentNode.cardinality <= 15 ? "primary" : "secondary",
            status: purity >= 0.98 ? "confirmed" : "needs_review",
          });
        }
      }
    }
  }

  // Step 5: Handle temporal fields separately (calendar hierarchy)
  const temporalNodes = nodes.filter((n) => n.role === "temporal");
  for (const tempNode of temporalNodes) {
    relationships.push({
      parent: `${tempNode.id}_year`,
      child: `${tempNode.id}_month`,
      type: "temporal_hierarchy",
      evidence: {
        method: "date_decomposition",
        sourceType,
        purity: 1.0,
        sampleSize: 10000,
      },
      confidence: 1.0,
      businessLabel: "Year > Month temporal rollup",
      priority: "primary",
      status: "confirmed",
    });
  }

  // Step 6: Check for conformed dimensions across entity scopes
  const conceptMap = new Map<string, string[]>(); // conceptName -> entityScopes
  for (const node of nodes) {
    const conceptName = node.aliasOf[0].replace(/^(customer|supplier|order|product)_?/i, "");
    if (conceptName && conceptName.length > 2) {
      if (!conceptMap.has(conceptName)) {
        conceptMap.set(conceptName, []);
      }
      if (!conceptMap.get(conceptName)!.includes(node.entityScope)) {
        conceptMap.get(conceptName)!.push(node.entityScope);
      }
    }
  }

  for (const [conceptName, scopes] of conceptMap.entries()) {
    if (scopes.length > 1) {
      conformedGroups.push({
        conceptName,
        memberEntityScopes: scopes,
        resolution: "separate",
        reason: `Concept ${conceptName} occurs across entities [${scopes.join(", ")}] with entity-specific scope`,
      });
    }
  }

  const rawOutput: RelationshipSchemaOutput = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    datasetId,
    sourceInputs: {
      fieldClassificationVersion: "1.0",
      domainKnowledgeVersion: "1.0",
    },
    nodes,
    relationships,
    conformedGroups,
    status: "OK",
    summary: "",
  };

  return enforceRelationshipStatusByPurity(rawOutput);
}

export function verifyNodeSampleValues(
  output: RelationshipSchemaOutput,
  fallbackOutput?: RelationshipSchemaOutput
): RelationshipSchemaOutput {
  if (!output || !Array.isArray(output.nodes)) return output;

  const fallbackNodes = fallbackOutput?.nodes || [];

  const verifiedNodes = output.nodes.map((node) => {
    // Find matching fallback node produced by ground-truth connector tool queries
    const fallbackMatch = fallbackNodes.find(
      (fn) => fn.id === node.id || (Array.isArray(fn.aliasOf) && Array.isArray(node.aliasOf) && fn.aliasOf.some((a) => node.aliasOf.includes(a)))
    );

    let sampleValues: string[] = [];
    if (fallbackMatch && Array.isArray(fallbackMatch.sampleValues) && fallbackMatch.sampleValues.length > 0) {
      // Overwrite with verified data connector value set
      sampleValues = fallbackMatch.sampleValues;
    } else if (Array.isArray(node.sampleValues) && fallbackMatch) {
      // Cross-check if model values overlap with verified fallback values
      const verifiedSet = new Set(fallbackMatch.sampleValues || []);
      if (verifiedSet.size > 0) {
        sampleValues = node.sampleValues.filter((val) => verifiedSet.has(val));
      } else {
        sampleValues = [];
      }
    } else if (node.cardinality > 0 && node.cardinality <= 20 && Array.isArray(node.sampleValues)) {
      sampleValues = node.sampleValues;
    }

    return {
      ...node,
      sampleValues,
    };
  });

  return {
    ...output,
    nodes: verifiedNodes,
  };
}

export function enforceRelationshipStatusByPurity(
  output: RelationshipSchemaOutput,
  fallbackOutput?: RelationshipSchemaOutput
): RelationshipSchemaOutput {
  if (!output) return output;

  const verifiedOutput = verifyNodeSampleValues(output, fallbackOutput);
  const nodes = Array.isArray(verifiedOutput.nodes) ? verifiedOutput.nodes : [];
  const rawRels = Array.isArray(verifiedOutput.relationships) ? verifiedOutput.relationships : [];
  const conformedGroups = Array.isArray(verifiedOutput.conformedGroups) ? verifiedOutput.conformedGroups : [];

  const updatedRelationships = rawRels.map((rel) => {
    const purity = typeof rel.evidence?.purity === "number" ? rel.evidence.purity : 1.0;
    let status: "confirmed" | "needs_review" | "rejected" = rel.status || "confirmed";

    if (purity >= 0.98) {
      status = "confirmed";
    } else if (purity >= 0.90 && purity < 0.98) {
      status = "needs_review";
    } else if (purity < 0.90) {
      status = "rejected";
    }

    return {
      ...rel,
      status,
    };
  });

  const summary = `Generated Relationship Schema with ${nodes.length} node(s), ${updatedRelationships.length} relationship(s), and ${conformedGroups.length} conformed group(s).`;

  return {
    ...verifiedOutput,
    nodes,
    relationships: updatedRelationships,
    conformedGroups,
    summary,
  };
}
