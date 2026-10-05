export interface RelationshipNode {
  id: string;
  columnName?: string;
  tableName?: string;
  aliasOf: string[];
  role: "identifier" | "categorical" | "location" | "temporal";
  entityScope: string;
  cardinality: number;
  sampleValues: string[];
}

export interface RelationshipEvidence {
  method: "dependency_stats" | "date_decomposition" | "value_set_comparison" | "manual_confirmed";
  sourceType: string;
  purity: number;
  sampleSize: number;
}

export interface HierarchyRelationship {
  parent: string;
  child: string;
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

export type RelationshipBuilderOutput = RelationshipSchemaOutput;
