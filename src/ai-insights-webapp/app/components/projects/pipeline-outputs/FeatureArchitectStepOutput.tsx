"use client";

import React, { useState } from "react";
import { Badge, SectionHeader } from "./utils";

interface FeatureArchitectStepOutputProps {
  featureArchitect?: any;
}

export default function FeatureArchitectStepOutput({
  featureArchitect,
}: FeatureArchitectStepOutputProps) {
  const [activeTab, setActiveTab] = useState<
    "creation" | "transformation" | "extraction" | "selection" | "orchestration"
  >("creation");

  const payload = featureArchitect?.featureArchitect || featureArchitect || {};
  const orch = payload?.orchestrationDecision || {};
  const creationRecs = Array.isArray(payload?.featureCreation?.recommendations)
    ? payload.featureCreation.recommendations
    : [];
  const transformRecs = Array.isArray(payload?.featureTransformation?.recommendations)
    ? payload.featureTransformation.recommendations
    : [];
  const extractRecs = Array.isArray(payload?.featureExtraction?.recommendations)
    ? payload.featureExtraction.recommendations
    : [];
  const selectRecs = Array.isArray(payload?.featureSelection?.recommendations)
    ? payload.featureSelection.recommendations
    : [];

  const totalCreatedFeatures = creationRecs.reduce(
    (sum: number, r: any) => sum + (Array.isArray(r.newFeatures) ? r.newFeatures.length : 0),
    0
  );

  const totalTransformedFeatures = transformRecs.reduce(
    (sum: number, r: any) => sum + (Array.isArray(r.transformations) ? r.transformations.length : 0),
    0
  );

  return (
    <div className="space-y-6 select-none">
      {/* Banner */}
      <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2.5 shadow-sm font-semibold select-none">
        <span className="text-sm">✓</span>
        <div>
          <strong className="block text-blue-900 dark:text-blue-400">Feature Architect Completed</strong>
          <p className="text-blue-700/90 dark:text-blue-300/80 mt-0.5">
            Engineered candidate features, transformations, component extractions, and feature selection routines.
          </p>
        </div>
      </div>

      {/* Meta Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Problem Type</div>
          <div className="text-sm font-semibold text-foreground mt-0.5 capitalize">{orch.problemType || "Time-Series Tabular"}</div>
        </div>
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Target Entity</div>
          <div className="text-sm font-semibold text-foreground mt-0.5">{orch.predictionEntity || orch.targetColumn || "Entity ID"}</div>
        </div>
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Created Features</div>
          <div className="text-sm font-semibold text-blue-600 dark:text-blue-400 mt-0.5">{totalCreatedFeatures} Candidates</div>
        </div>
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Transformations</div>
          <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">{totalTransformedFeatures} Columns</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-4 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab("creation")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "creation"
              ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Created Features ({totalCreatedFeatures})
        </button>
        <button
          onClick={() => setActiveTab("transformation")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "transformation"
              ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Transformations ({totalTransformedFeatures})
        </button>
        <button
          onClick={() => setActiveTab("extraction")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "extraction"
              ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Extractions
        </button>
        <button
          onClick={() => setActiveTab("selection")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "selection"
              ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Feature Selection
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === "creation" && (
        <div className="space-y-4 select-text">
          <SectionHeader
            title="Engineered Candidate Features"
            subtitle="Calculated rolling aggregations, lags, ratios, and interactions"
            badgeText={`${totalCreatedFeatures} Features`}
          />
          {creationRecs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No new feature creation recommendations recorded.
            </div>
          ) : (
            <div className="space-y-4">
              {creationRecs.map((tableRec: any, idx: number) => (
                <div key={idx} className="border border-border rounded overflow-hidden">
                  <div className="bg-surface-muted px-3 py-2 border-b border-border font-mono text-xs font-bold text-foreground">
                    Table: {tableRec.tableName}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-surface-muted/50 border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                        <tr>
                          <th className="py-2 px-3">Feature Name</th>
                          <th className="py-2 px-3">Technique</th>
                          <th className="py-2 px-3">Source Columns</th>
                          <th className="py-2 px-3">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {Array.isArray(tableRec.newFeatures) &&
                          tableRec.newFeatures.map((f: any, fIdx: number) => (
                            <tr key={fIdx} className="hover:bg-surface-muted/30">
                              <td className="py-2 px-3 font-mono font-medium text-foreground">{f.featureName}</td>
                              <td className="py-2 px-3">
                                <Badge variant="primary">{f.technique}</Badge>
                              </td>
                              <td className="py-2 px-3 font-mono text-muted-foreground">
                                {Array.isArray(f.sourceColumns) ? f.sourceColumns.join(", ") : f.sourceColumns || "-"}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">{f.description}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "transformation" && (
        <div className="space-y-4 select-text">
          <SectionHeader
            title="Feature Transformations"
            subtitle="Encodings, scalers, imputations, and power transforms"
            badgeText={`${totalTransformedFeatures} Transformed`}
          />
          {transformRecs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No transformation recommendations recorded.
            </div>
          ) : (
            <div className="space-y-4">
              {transformRecs.map((tableRec: any, idx: number) => (
                <div key={idx} className="border border-border rounded overflow-hidden">
                  <div className="bg-surface-muted px-3 py-2 border-b border-border font-mono text-xs font-bold text-foreground">
                    Table: {tableRec.tableName}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-surface-muted/50 border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                        <tr>
                          <th className="py-2 px-3">Column Name</th>
                          <th className="py-2 px-3">Transformation</th>
                          <th className="py-2 px-3">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {Array.isArray(tableRec.transformations) &&
                          tableRec.transformations.map((t: any, tIdx: number) => (
                            <tr key={tIdx} className="hover:bg-surface-muted/30">
                              <td className="py-2 px-3 font-mono font-medium text-foreground">{t.columnName}</td>
                              <td className="py-2 px-3">
                                <Badge variant="teal">{t.technique}</Badge>
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">{t.description}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "extraction" && (
        <div className="space-y-4 select-text">
          <SectionHeader
            title="Dimensionality & Component Extractions"
            subtitle="PCA, UMAP, and decomposition recommendations"
          />
          {extractRecs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No dimensionality reduction / extractions required for this dataset.
            </div>
          ) : (
            <div className="space-y-4">
              {extractRecs.map((tableRec: any, idx: number) => (
                <div key={idx} className="border border-border rounded p-3 space-y-2">
                  <div className="font-mono text-xs font-bold">{tableRec.tableName}</div>
                  {Array.isArray(tableRec.extractions) &&
                    tableRec.extractions.map((e: any, eIdx: number) => (
                      <div key={eIdx} className="text-xs bg-surface-muted p-2 rounded flex justify-between items-center">
                        <div>
                          <Badge variant="purple">{e.technique}</Badge>
                          <span className="ml-2 font-mono text-muted-foreground">{e.numberOfComponents} components</span>
                        </div>
                        <div className="text-muted-foreground">{e.rationale}</div>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "selection" && (
        <div className="space-y-4 select-text">
          <SectionHeader
            title="Feature Selection Summary"
            subtitle="Importance ranking and variance threshold filtering"
          />
          {selectRecs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No feature selection recommendations recorded.
            </div>
          ) : (
            <div className="space-y-4">
              {selectRecs.map((tableRec: any, idx: number) => (
                <div key={idx} className="border border-border rounded p-4 space-y-3">
                  <div className="font-mono text-xs font-bold text-foreground">Table: {tableRec.tableName}</div>
                  {Array.isArray(tableRec.selections) &&
                    tableRec.selections.map((s: any, sIdx: number) => (
                      <div key={sIdx} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="success">Selected: {s.selectedFeatures?.length || 0}</Badge>
                          <Badge variant="neutral">Discarded: {s.discardedFeatures?.length || 0}</Badge>
                          <span className="text-xs font-semibold text-muted-foreground">Method: {s.methodology}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{s.rationale}</p>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
