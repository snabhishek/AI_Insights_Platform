"use client";

import React, { useState } from "react";
import { Badge, SectionHeader } from "./utils";

interface HierarchyMapperStepOutputProps {
  hierarchyMapper?: any;
  relationshipBuilder?: any;
  formBuilder?: any;
}

export default function HierarchyMapperStepOutput({
  hierarchyMapper,
  relationshipBuilder,
  formBuilder,
}: HierarchyMapperStepOutputProps) {
  const [activeTab, setActiveTab] = useState<"relationships" | "forms">("relationships");

  // Resolve relationship output
  const relData = relationshipBuilder || hierarchyMapper?.relationshipBuilder || hierarchyMapper;
  const formData = formBuilder || hierarchyMapper?.formBuilder || hierarchyMapper;

  const nodes: any[] = Array.isArray(relData?.nodes) ? relData.nodes : [];
  const relationships: any[] = Array.isArray(relData?.relationships) ? relData.relationships : [];
  const conformedGroups: any[] = Array.isArray(relData?.conformedGroups) ? relData.conformedGroups : [];
  const filterGroups: any[] = Array.isArray(formData?.forms)
    ? formData.forms
    : Array.isArray(formData?.filterGroups)
    ? formData.filterGroups
    : [];

  const getRoleBadgeVariant = (role: string) => {
    const norm = (role || "").toLowerCase();
    if (norm.includes("identifier")) return "primary";
    if (norm.includes("location")) return "purple";
    if (norm.includes("temporal")) return "teal";
    return "neutral";
  };

  const getStatusBadgeVariant = (status: string) => {
    const norm = (status || "").toLowerCase();
    if (norm.includes("confirmed")) return "success";
    if (norm.includes("review")) return "warning";
    if (norm.includes("rejected")) return "error";
    return "neutral";
  };

  const getControlTypeBadgeVariant = (controlType: string) => {
    const norm = (controlType || "").toLowerCase();
    if (norm.includes("date_range") || norm.includes("date")) return "teal";
    if (norm.includes("searchable")) return "purple";
    if (norm.includes("multi")) return "primary";
    return "neutral";
  };

  return (
    <div className="space-y-6 select-none">
      {/* Banner */}
      <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5 shadow-sm font-semibold select-none">
        <span className="text-sm">✓</span>
        <div>
          <strong className="block text-emerald-900 dark:text-emerald-400">Hierarchy Mapper Completed</strong>
          <p className="text-emerald-700/90 dark:text-emerald-300/80 mt-0.5">
            Functional dependencies, entity hierarchies, and dynamic form schemas have been discovered and compiled.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab("relationships")}
          className={`pb-2 transition-colors ${
            activeTab === "relationships"
              ? "border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Relationship Schema ({nodes.length} Nodes, {relationships.length} Links)
        </button>
        <button
          onClick={() => setActiveTab("forms")}
          className={`pb-2 transition-colors ${
            activeTab === "forms"
              ? "border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Dynamic Form Schema ({filterGroups.length} Groups)
        </button>
      </div>

      {activeTab === "relationships" && (
        <div className="space-y-6 select-text">
          {/* Nodes Table */}
          <div className="space-y-3">
            <SectionHeader title="Hierarchy Nodes" subtitle="Discovered entity nodes and column aliases" badgeText={`${nodes.length} Nodes`} />
            <div className="border border-border overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  <tr>
                    <th className="p-3">Canonical ID</th>
                    <th className="p-3">Original Alias</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Entity Scope</th>
                    <th className="p-3">Cardinality</th>
                    <th className="p-3">Sample Values</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {nodes.map((node, idx) => (
                    <tr key={idx} className="hover:bg-surface-muted/30">
                      <td className="p-3 font-mono font-bold text-foreground">{node.id}</td>
                      <td className="p-3 text-muted-foreground">{Array.isArray(node.aliasOf) ? node.aliasOf.join(", ") : node.aliasOf || "-"}</td>
                      <td className="p-3">
                        <Badge variant={getRoleBadgeVariant(node.role)}>{node.role}</Badge>
                      </td>
                      <td className="p-3 font-semibold text-foreground">{node.entityScope}</td>
                      <td className="p-3 font-mono">{node.cardinality || 0}</td>
                      <td className="p-3 text-muted-foreground truncate max-w-xs font-mono text-[11px]">
                        {Array.isArray(node.sampleValues) && node.sampleValues.length > 0 ? node.sampleValues.join(", ") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Relationships Table */}
          <div className="space-y-3">
            <SectionHeader title="Functional Dependencies & Hierarchies" subtitle="Statistical parent-child dependencies and purity ratios" badgeText={`${relationships.length} Links`} />
            <div className="border border-border overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  <tr>
                    <th className="p-3">Parent</th>
                    <th className="p-3">Child</th>
                    <th className="p-3">Hierarchy Type</th>
                    <th className="p-3">Purity</th>
                    <th className="p-3">Business Label</th>
                    <th className="p-3">Priority</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {relationships.map((rel, idx) => (
                    <tr key={idx} className="hover:bg-surface-muted/30">
                      <td className="p-3 font-mono font-bold text-foreground">{rel.parent}</td>
                      <td className="p-3 font-mono text-emerald-600 dark:text-emerald-400 font-bold">{rel.child}</td>
                      <td className="p-3 font-medium text-foreground">{rel.type}</td>
                      <td className="p-3 font-mono font-bold">{rel.evidence?.purity != null ? (rel.evidence.purity * 100).toFixed(1) + "%" : "100%"}</td>
                      <td className="p-3 text-foreground font-semibold">{rel.businessLabel || "-"}</td>
                      <td className="p-3">
                        <Badge variant={rel.priority === "primary" ? "primary" : "neutral"}>{rel.priority || "secondary"}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={getStatusBadgeVariant(rel.status)}>{rel.status || "confirmed"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Conformed Groups */}
          {conformedGroups.length > 0 && (
            <div className="p-4 border border-border bg-surface-muted/30 space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block">Conformed Dimension Decisions</span>
              <div className="space-y-1.5">
                {conformedGroups.map((cg, idx) => (
                  <div key={idx} className="text-xs flex items-center gap-2">
                    <span className="font-bold text-foreground">{cg.conceptName}:</span>
                    <span className="text-muted-foreground">[{Array.isArray(cg.memberEntityScopes) ? cg.memberEntityScopes.join(", ") : ""}]</span>
                    <Badge variant={cg.resolution === "shared" ? "success" : "neutral"}>{cg.resolution}</Badge>
                    <span className="text-muted-foreground italic text-[11px]">- {cg.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "forms" && (
        <div className="space-y-6 select-text">
          {filterGroups.map((grp: any, idx: number) => {
            const title = grp.title || grp.groupName || `Group #${idx + 1}`;
            const targetEntity = grp.targetEntity || grp.groupName || "Entity";
            const fields: any[] = Array.isArray(grp.fields) ? grp.fields : [];

            return (
              <div key={idx} className="border border-border p-4 bg-surface/50 space-y-4">
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">{title}</h4>
                    <p className="text-[11px] text-muted-foreground">{grp.description || `Target Entity: ${targetEntity}`}</p>
                  </div>
                  <Badge variant={grp.priority === "primary" ? "teal" : "neutral"}>{grp.priority || "primary"}</Badge>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Form Fields</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {fields.map((f: any, fIdx: number) => {
                      const parentFieldsList: string[] = Array.isArray(f.parentFields) && f.parentFields.length > 0
                        ? f.parentFields
                        : f.parentField
                        ? [f.parentField]
                        : [];

                      return (
                        <div key={fIdx} className="p-3 border border-border bg-surface-muted/20 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold font-mono text-foreground">{f.fieldId || f.name}</span>
                            <Badge variant={getControlTypeBadgeVariant(f.controlType || f.type)}>{f.controlType || f.type || "dropdown"}</Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground font-medium">{f.label || f.description || ""}</p>
                          
                          {/* Multi-Parent Badge Rendering */}
                          {parentFieldsList.length > 0 ? (
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold">Depends on parents:</span>
                              {parentFieldsList.map((p, pIdx) => (
                                <span key={pIdx} className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
                                  {p}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground/70 font-mono italic">
                              Top-level filter (no parents)
                            </div>
                          )}

                          {Array.isArray(f.options) && f.options.length > 0 && (
                            <div className="text-[10px] text-muted-foreground font-mono truncate">
                              Inline Options: {f.options.join(", ")}
                            </div>
                          )}
                          {f.optionsSource === "api" && (
                            <div className="text-[10px] text-muted-foreground/80 font-mono truncate">
                              Live API: {f.optionsEndpoint || `/api/connectors/filter-options?field=${f.fieldId || f.name}`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
