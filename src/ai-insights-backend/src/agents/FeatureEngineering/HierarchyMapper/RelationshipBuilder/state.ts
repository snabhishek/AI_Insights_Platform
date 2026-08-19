export interface RelationshipNode {
  id: string; // Canonical ID (e.g., "product", "order_country")
  aliasOf: string[]; // Original columns merged into this node
  role: "identifier" | "categorical" | "location" | "temporal";
  entityScope: string; // Entity group (e.g. "product", "customer", "order")
  cardinality: number;
  sampleValues: string[];
}

export interface RelationshipEvidence {
  method: "dependency_stats" | "date_decomposition" | "value_set_comparison" | "manual_confirmed";
  sourceType: string; // "database" | "csv" | "tsv" | "excel" | "json_api"
  purity: number; // 0.0 to 1.0
  sampleSize: number;
}

export interface HierarchyRelationship {
  parent: string; // parent node id
  child: string; // child node id
  type: "strict_hierarchy" | "geographic_hierarchy" | "temporal_hierarchy" | "reference_link";
  evidence: RelationshipEvidence;
  confidence: number;
  businessLabel: string;
  priority: "primary" | "secondary";
  status: "confirmed" | "needs_review" | "rejected";
}

export interface ConformedGroup {
  conceptName: string;
  memberEntityScopes: string[];
  resolution: "shared" | "separate";
  reason: string;
}

export interface RelationshipSchemaOutput {
  version: string;
  generatedAt: string;
  datasetId: string;
  sourceInputs: {
    fieldClassificationVersion: string;
    domainKnowledgeVersion: string;
  };
  nodes: RelationshipNode[];
  relationships: HierarchyRelationship[];
  conformedGroups: ConformedGroup[];
  status?: string;
  summary?: string;
}

// Backward-compatible alias
export type RelationshipBuilderOutput = RelationshipSchemaOutput;
