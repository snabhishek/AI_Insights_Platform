"use client";

import React, { useState } from "react";
import { Badge, SectionHeader } from "./utils";
import type { FeatureExtractionRecommendation, FeatureSelectionRecommendation } from "../pipelineNames";

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
  const extractRecs: FeatureExtractionRecommendation[] = Array.isArray(payload?.featureExtraction?.recommendations)
    ? payload.featureExtraction.recommendations
    : [];
  const selectRecs: FeatureSelectionRecommendation[] = Array.isArray(payload?.featureSelection?.recommendations)
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
          {payload.featureExtraction?.summary && (
            <p className="text-xs text-muted-foreground">{payload.featureExtraction.summary}</p>
          )}
          {extractRecs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No feature extraction recommendations recorded.
            </div>
          ) : (
            <div className="space-y-4">
              {extractRecs.map((recommendation, idx) => (
                <div key={idx} className="border border-border rounded p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="purple">{recommendation.method}</Badge>
                    <span className="font-mono text-muted-foreground">{recommendation.extractedFeaturesCount} components</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{recommendation.description}</p>
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
          {payload.featureSelection?.summary && (
            <p className="text-xs text-muted-foreground">{payload.featureSelection.summary}</p>
          )}
          {selectRecs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No feature selection recommendations recorded.
            </div>
          ) : (
            <div className="space-y-4">
              {selectRecs.map((recommendation, idx) => (
                <div key={idx} className="border border-border rounded p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">Selected: {recommendation.selectedFeatures.length}</Badge>
                    <Badge variant="neutral">Discarded: {recommendation.droppedFeatures.length}</Badge>
                    <span className="text-xs font-semibold text-muted-foreground">Method: {recommendation.method}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{recommendation.description}</p>
                  {recommendation.selectedFeatures.length > 0 && (
                    <p className="text-xs text-muted-foreground break-words">
                      Selected features: <span className="font-mono">{recommendation.selectedFeatures.join(", ")}</span>
                    </p>
                  )}
                  {recommendation.droppedFeatures.length > 0 && (
                    <p className="text-xs text-muted-foreground break-words">
                      Discarded features: <span className="font-mono">{recommendation.droppedFeatures.join(", ")}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
