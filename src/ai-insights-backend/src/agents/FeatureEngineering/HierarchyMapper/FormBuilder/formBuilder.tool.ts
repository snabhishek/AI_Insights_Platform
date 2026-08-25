import { FormBuilderOutput, HierarchicalFormSchema, FormFieldDefinition } from "./state";
import { RelationshipSchemaOutput } from "../RelationshipBuilder/state";

export interface GenerateFormsInput {
  relationshipBuilderOutput?: RelationshipSchemaOutput;
  schemaResolution?: Record<string, unknown>;
  userPrompt?: string;
  sourceId?: string;
}

export async function generateHierarchicalFormsTool(
  input: GenerateFormsInput
): Promise<FormBuilderOutput> {
  const relOutput = input.relationshipBuilderOutput;
  const nodes = relOutput?.nodes || [];
  const relationships = relOutput?.relationships || [];
  const sourceId = input.sourceId || (relOutput as any)?.sourceId;

  const filterGroups: HierarchicalFormSchema[] = [];

  // Group nodes by entity scope
  const entityGroupMap = new Map<string, typeof nodes>();
  for (const node of nodes) {
    const scope = node.entityScope || "general";
    if (!entityGroupMap.has(scope)) {
      entityGroupMap.set(scope, []);
    }
    entityGroupMap.get(scope)!.push(node);
  }

  for (const [entityScope, groupNodes] of entityGroupMap.entries()) {
    const fields: FormFieldDefinition[] = [];

    for (const node of groupNodes) {
      if (node.role === "identifier") continue;

      // Find all parent relationships where r.child === node.id
      const parentRels = relationships.filter((r) => r.child === node.id && r.status !== "rejected");
      const parentFields = parentRels.map((r) => r.parent);

      // Control type determination
      const isDailyDate = /date|timestamp/i.test(node.id) && !/year|quarter|month|week|dayofweek/i.test(node.id);
      const isCalendarUnit = /year|quarter|month|week|dayofweek/i.test(node.id) || (node.role === "temporal" && !isDailyDate);

      const controlType = isDailyDate
        ? "date_range"
        : (isCalendarUnit || (node.cardinality > 0 && node.cardinality <= 50))
        ? "dropdown"
        : node.role === "location"
        ? "searchable_dropdown"
        : "dropdown";

      const colName = node.columnName || node.aliasOf?.[0] || node.id;

      fields.push({
        name: colName,
        fieldId: colName,
        columnName: colName,
        tableName: node.tableName,
        label: node.aliasOf && node.aliasOf[0] ? node.aliasOf[0].replace(/_/g, " ").toUpperCase() : colName,
        description: `Filter field in ${entityScope} (Role: ${node.role})`,
        controlType,
        parentField: parentFields[0] || null,
        parentFields,
        options: node.sampleValues && node.sampleValues.length > 0 ? node.sampleValues : undefined,
        requiredParentParams: parentFields,
        dependsOn: parentFields[0],
      });
    }

    if (fields.length > 0) {
      filterGroups.push({
        formId: `group-${entityScope}`,
        groupName: entityScope.charAt(0).toUpperCase() + entityScope.slice(1),
        priority: entityScope === "general" || entityScope === "time" ? "primary" : "secondary",
        title: `${entityScope.toUpperCase()} Filters`,
        description: `Cascading hierarchical feature filters for ${entityScope}`,
        targetEntity: entityScope,
        fields,
      });
    }
  }

  const rawOutput: FormBuilderOutput = {
    sourceId,
    status: "OK",
    summary: "",
    forms: filterGroups,
    filterGroups,
  };

  return normalizeAndEnforceFormSchema(rawOutput, relOutput, sourceId);
}

export function normalizeAndEnforceFormSchema(
  output: any,
  relationshipSchema?: RelationshipSchemaOutput,
  fallbackSourceId?: string
): FormBuilderOutput {
  if (!output) return output;

  const resolvedSourceId = output.sourceId || (relationshipSchema as any)?.sourceId || fallbackSourceId;

  const rawGroups: any[] = Array.isArray(output.filterGroups)
    ? output.filterGroups
    : Array.isArray(output.forms)
    ? output.forms
    : [];

  const relNodes = relationshipSchema?.nodes || [];
  const rels = relationshipSchema?.relationships || [];

  // Track visited nodes
  const visitedNodeIds = new Set<string>();

  const normalizedGroups = rawGroups.map((group: any) => {
    const rawFields = Array.isArray(group.fields) ? group.fields : [];
    const normalizedFields = rawFields.map((field: any) => {
      const fieldId = field.columnName || field.fieldId || field.name || field.id;
      visitedNodeIds.add(fieldId);

      const relNode = relNodes.find(
        (n) => n.id === fieldId || n.columnName === fieldId || (n.aliasOf && n.aliasOf.includes(fieldId))
      );

      // Collect all parent relationships
      const activeParentRels = rels.filter(
        (r) => (r.child === fieldId || (relNode && r.child === relNode.id)) && r.status !== "rejected"
      );
      const parentFields: string[] = Array.isArray(field.parentFields) && field.parentFields.length > 0
        ? field.parentFields
        : activeParentRels.map((r) => r.parent);

      // Calendar Control Overrides
      const isDailyDate = /date|timestamp/i.test(fieldId) && !/year|quarter|month|week|dayofweek/i.test(fieldId);
      const isCalendarUnit = /year|quarter|month|week|dayofweek/i.test(fieldId) || (relNode?.role === "temporal" && !isDailyDate);

      let controlType = field.controlType || "dropdown";
      if (isDailyDate) {
        controlType = "date_range";
      } else if (isCalendarUnit) {
        controlType = "dropdown";
      }

      // Explicitly remove legacy optionsSource and optionsEndpoint
      const { optionsSource, optionsEndpoint, ...cleanField } = field;

      const resolvedOptions =
        Array.isArray(field.options) && field.options.length > 0
          ? field.options
          : (relNode?.sampleValues && relNode.sampleValues.length > 0 ? relNode.sampleValues : undefined);

      return {
        ...cleanField,
        fieldId,
        name: fieldId,
        columnName: field.columnName || relNode?.columnName || fieldId,
        tableName: field.tableName || relNode?.tableName,
        label: field.label || (relNode?.aliasOf?.[0] ? relNode.aliasOf[0].replace(/_/g, " ").toUpperCase() : fieldId),
        controlType,
        parentField: parentFields[0] || field.parentField || null,
        parentFields,
        requiredParentParams: parentFields,
        options: resolvedOptions,
      };
    });

    return {
      ...group,
      groupName: group.groupName || group.title || group.formId || "Filter Group",
      fields: normalizedFields,
    };
  });

  // Collect zero-edge standalone nodes not yet visited
  const standaloneFields: FormFieldDefinition[] = [];
  for (const node of relNodes) {
    const colName = node.columnName || node.aliasOf?.[0] || node.id;
    if (node.role === "identifier" || visitedNodeIds.has(node.id) || visitedNodeIds.has(colName)) continue;

    const hasEdges = rels.some((r) => r.parent === node.id || r.child === node.id);
    if (!hasEdges) {
      visitedNodeIds.add(node.id);
      visitedNodeIds.add(colName);
      const isDailyDate = /date|timestamp/i.test(colName) && !/year|quarter|month|week|dayofweek/i.test(colName);

      standaloneFields.push({
        fieldId: colName,
        name: colName,
        columnName: colName,
        tableName: node.tableName,
        label: node.aliasOf && node.aliasOf[0] ? node.aliasOf[0].replace(/_/g, " ").toUpperCase() : colName,
        description: `Standalone feature filter (Role: ${node.role})`,
        controlType: isDailyDate ? "date_range" : "dropdown",
        parentField: null,
        parentFields: [],
        options: node.sampleValues && node.sampleValues.length > 0 ? node.sampleValues : undefined,
      });
    }
  }

  if (standaloneFields.length > 0) {
    let otherGroup = normalizedGroups.find((g: any) => /other|standalone|general/i.test(g.groupName || ""));
    if (otherGroup) {
      otherGroup.fields.push(...standaloneFields);
    } else {
      normalizedGroups.push({
        formId: "group-other",
        groupName: "Other Filters",
        priority: "secondary",
        title: "Other Standalone Filters",
        description: "Standalone feature filters without hierarchical dependencies",
        targetEntity: "other",
        fields: standaloneFields,
      });
    }
  }

  const totalFields = normalizedGroups.reduce((acc, g) => acc + (g.fields?.length || 0), 0);
  const summary = `Generated ${normalizedGroups.length} filter group(s) with ${totalFields} total field(s) from Relationship Schema.`;

  return {
    sourceId: resolvedSourceId,
    status: "OK",
    summary,
    forms: normalizedGroups,
    filterGroups: normalizedGroups,
  };
}
