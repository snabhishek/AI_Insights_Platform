"use client";

import React, { useState } from "react";
import { Badge, SectionHeader } from "./utils";

interface FeatureValidatorStepOutputProps {
  featureValidator?: any;
}

export default function FeatureValidatorStepOutput({
  featureValidator,
}: FeatureValidatorStepOutputProps) {
  const [activeTab, setActiveTab] = useState<
    "importance" | "leakage" | "multicollinearity" | "drift" | "featureSet"
  >("importance");

  const payload = featureValidator?.featureValidator || featureValidator || {};

  const leakage = payload?.leakageReport || {};
  const leakyFeatures: any[] = Array.isArray(leakage?.leakyFeatures) ? leakage.leakyFeatures : [];

  const multicollinearity = payload?.multicollinearityReport || {};
  const highVifFeatures: any[] = Array.isArray(multicollinearity?.highVifFeatures)
    ? multicollinearity.highVifFeatures
    : [];
  const highCorrelationPairs: any[] = Array.isArray(multicollinearity?.highCorrelationPairs)
    ? multicollinearity.highCorrelationPairs
    : [];

  const drift = payload?.driftReport || {};
  const driftedFeatures: any[] = Array.isArray(drift?.driftedFeatures) ? drift.driftedFeatures : [];

  const importanceRanking: any[] = Array.isArray(payload?.importanceRanking)
    ? payload.importanceRanking
    : [];

  const validatedSet = payload?.validatedFeatureSet || {};
  const keptFeatures: string[] = Array.isArray(validatedSet?.kept) ? validatedSet.kept : [];
  const droppedFeatures: any[] = Array.isArray(validatedSet?.dropped) ? validatedSet.dropped : [];

  const hasLeakage = leakage.leakageFound || leakyFeatures.length > 0;
  const totalKept = keptFeatures.length || validatedSet.totalKept || 0;
  const totalDropped = droppedFeatures.length || validatedSet.totalDropped || 0;

  return (
    <div className="space-y-6 select-none">
      {/* Banner */}
      <div
        className={`p-4 border text-xs flex items-start gap-2.5 shadow-sm font-semibold select-none ${
          hasLeakage
            ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300"
            : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300"
        }`}
      >
        <span className="text-sm">{hasLeakage ? "⚠" : "✓"}</span>
        <div>
          <strong
            className={`block ${
              hasLeakage ? "text-amber-900 dark:text-amber-400" : "text-emerald-900 dark:text-emerald-400"
            }`}
          >
            {hasLeakage ? "Feature Validation Completed with Leakage Remediation" : "Feature Validation Completed Successfully"}
          </strong>
          <p className={hasLeakage ? "text-amber-700/90 dark:text-amber-300/80 mt-0.5" : "text-emerald-700/90 dark:text-emerald-300/80 mt-0.5"}>
            {payload?.summary ||
              "Feature matrix audited for target leakage, multicollinearity, and population drift. Validated dataset compiled."}
          </p>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Validated Kept</div>
          <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{totalKept} Features</div>
        </div>
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Total Dropped</div>
          <div className="text-base font-bold text-rose-600 dark:text-rose-400 mt-0.5">{totalDropped} Features</div>
        </div>
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Leaky Dropped</div>
          <div className="text-base font-bold text-amber-600 dark:text-amber-400 mt-0.5">{leakyFeatures.length}</div>
        </div>
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Collinear Dropped</div>
          <div className="text-base font-bold text-purple-600 dark:text-purple-400 mt-0.5">
            {highVifFeatures.filter((f) => f.action === "dropped").length + highCorrelationPairs.length}
          </div>
        </div>
        <div className="p-3 bg-surface-muted border border-border rounded">
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Drift Flagged</div>
          <div className="text-base font-bold text-sky-600 dark:text-sky-400 mt-0.5">
            {driftedFeatures.filter((f) => f.status === "drift_detected").length}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-4 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab("importance")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "importance"
              ? "border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Importance Ranking ({importanceRanking.length})
        </button>
        <button
          onClick={() => setActiveTab("leakage")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "leakage"
              ? "border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Leakage Audit ({leakyFeatures.length})
        </button>
        <button
          onClick={() => setActiveTab("multicollinearity")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "multicollinearity"
              ? "border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Multicollinearity ({highVifFeatures.length + highCorrelationPairs.length})
        </button>
        <button
          onClick={() => setActiveTab("drift")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "drift"
              ? "border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Feature Drift ({driftedFeatures.length})
        </button>
        <button
          onClick={() => setActiveTab("featureSet")}
          className={`pb-2 transition-colors whitespace-nowrap ${
            activeTab === "featureSet"
              ? "border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Validated Feature Set ({totalKept})
        </button>
      </div>

      {/* Tab: Importance Ranking */}
      {activeTab === "importance" && (
        <div className="space-y-4 select-text">
          <SectionHeader
            title="Feature Importance Rankings"
            subtitle="Permutation and model-based feature importance scores"
            badgeText={`${importanceRanking.length} Ranked`}
          />
          {importanceRanking.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No importance rankings available.
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  <tr>
                    <th className="py-2 px-3 w-16">Rank</th>
                    <th className="py-2 px-3">Feature Name</th>
                    <th className="py-2 px-3 w-32 text-right">Importance Score</th>
                    <th className="py-2 px-3 w-48">Relative Power</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {importanceRanking.map((item: any, idx: number) => {
                    const score = typeof item.importanceScore === "number" ? item.importanceScore : 0;
                    const maxScore = Math.max(...importanceRanking.map((r: any) => r.importanceScore || 0), 1);
                    const pct = Math.round((score / maxScore) * 100);

                    return (
                      <tr key={idx} className="hover:bg-surface-muted/30">
                        <td className="py-2 px-3 font-mono font-bold text-muted-foreground">#{item.rank || idx + 1}</td>
                        <td className="py-2 px-3 font-mono font-medium text-foreground">{item.featureName}</td>
                        <td className="py-2 px-3 font-mono text-right font-semibold text-amber-600 dark:text-amber-400">
                          {score.toFixed(4)}
                        </td>
                        <td className="py-2 px-3">
                          <div className="w-full bg-surface-muted rounded-full h-2 overflow-hidden border border-border">
                            <div
                              className="bg-amber-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Leakage Audit */}
      {activeTab === "leakage" && (
        <div className="space-y-4 select-text">
          <SectionHeader
            title="Target Leakage Audit"
            subtitle="Automated checks for future-information leakage and target proxies"
            badgeText={hasLeakage ? "Leakage Detected" : "Clean"}
          />
          {leakyFeatures.length === 0 ? (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <span>✓</span> No target leakage or temporal lookahead violations detected.
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  <tr>
                    <th className="py-2 px-3">Leaky Feature</th>
                    <th className="py-2 px-3">Violation Reason</th>
                    <th className="py-2 px-3">Probe Metric</th>
                    <th className="py-2 px-3">Action Taken</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leakyFeatures.map((lf: any, idx: number) => (
                    <tr key={idx} className="hover:bg-surface-muted/30">
                      <td className="py-2 px-3 font-mono font-medium text-rose-600 dark:text-rose-400">{lf.featureName}</td>
                      <td className="py-2 px-3 text-muted-foreground">{lf.reason}</td>
                      <td className="py-2 px-3 font-mono text-muted-foreground">
                        {lf.metricScore !== undefined ? `AUC/R²: ${lf.metricScore.toFixed(3)}` : "-"}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={lf.action === "dropped" ? "error" : "warning"}>
                          {lf.action === "dropped" ? "Auto-Dropped" : "Flagged"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Multicollinearity */}
      {activeTab === "multicollinearity" && (
        <div className="space-y-6 select-text">
          {/* High VIF */}
          <div className="space-y-3">
            <SectionHeader
              title="Variance Inflation Factor (VIF)"
              subtitle="Multicollinearity audit (VIF > 10 considered severe)"
              badgeText={`${highVifFeatures.length} VIF Flags`}
            />
            {highVifFeatures.length === 0 ? (
              <div className="text-xs text-muted-foreground italic p-3 border border-border rounded">
                No features exceeded the VIF multicollinearity threshold.
              </div>
            ) : (
              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    <tr>
                      <th className="py-2 px-3">Feature Name</th>
                      <th className="py-2 px-3">VIF Score</th>
                      <th className="py-2 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {highVifFeatures.map((f: any, idx: number) => (
                      <tr key={idx} className="hover:bg-surface-muted/30">
                        <td className="py-2 px-3 font-mono font-medium text-foreground">{f.featureName}</td>
                        <td className="py-2 px-3 font-mono font-semibold text-rose-600 dark:text-rose-400">
                          {typeof f.vifScore === "number" ? f.vifScore.toFixed(2) : f.vifScore}
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={f.action === "dropped" ? "error" : "primary"}>
                            {f.action === "dropped" ? "Dropped" : "Kept"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* High Correlation Pairs */}
          <div className="space-y-3">
            <SectionHeader
              title="Pairwise High Correlation Resolution"
              subtitle="Collinear feature pairs (|r| > 0.95) resolved by dropping lower importance feature"
              badgeText={`${highCorrelationPairs.length} Pairs`}
            />
            {highCorrelationPairs.length === 0 ? (
              <div className="text-xs text-muted-foreground italic p-3 border border-border rounded">
                No pairwise correlations exceeded the redundancy threshold.
              </div>
            ) : (
              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    <tr>
                      <th className="py-2 px-3">Feature Pair</th>
                      <th className="py-2 px-3">Correlation (|r|)</th>
                      <th className="py-2 px-3">Dropped Feature</th>
                      <th className="py-2 px-3">Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {highCorrelationPairs.map((pair: any, idx: number) => (
                      <tr key={idx} className="hover:bg-surface-muted/30">
                        <td className="py-2 px-3 font-mono text-muted-foreground">
                          <span className="font-semibold text-foreground">{pair.feature1}</span> vs{" "}
                          <span className="font-semibold text-foreground">{pair.feature2}</span>
                        </td>
                        <td className="py-2 px-3 font-mono font-semibold text-amber-600 dark:text-amber-400">
                          {typeof pair.correlation === "number" ? pair.correlation.toFixed(3) : pair.correlation}
                        </td>
                        <td className="py-2 px-3 font-mono font-semibold text-rose-600 dark:text-rose-400">
                          {pair.droppedFeature}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{pair.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Feature Drift */}
      {activeTab === "drift" && (
        <div className="space-y-4 select-text">
          <SectionHeader
            title="Population Stability Index (PSI) & Drift"
            subtitle="Distribution stability between training and validation splits"
            badgeText={`${driftedFeatures.length} Drift Checked`}
          />
          {driftedFeatures.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-4 border border-border rounded text-center">
              No drift assessments recorded.
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  <tr>
                    <th className="py-2 px-3">Feature Name</th>
                    <th className="py-2 px-3">PSI Score</th>
                    <th className="py-2 px-3">p-value</th>
                    <th className="py-2 px-3">Stability Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {driftedFeatures.map((d: any, idx: number) => (
                    <tr key={idx} className="hover:bg-surface-muted/30">
                      <td className="py-2 px-3 font-mono font-medium text-foreground">{d.featureName}</td>
                      <td className="py-2 px-3 font-mono font-semibold text-muted-foreground">
                        {typeof d.psiScore === "number" ? d.psiScore.toFixed(4) : d.psiScore}
                      </td>
                      <td className="py-2 px-3 font-mono text-muted-foreground">
                        {d.pValue !== undefined ? d.pValue.toFixed(4) : "-"}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={d.status === "drift_detected" ? "warning" : "success"}>
                          {d.status === "drift_detected" ? "Drift Detected (Flagged)" : "Stable"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Validated Feature Set */}
      {activeTab === "featureSet" && (
        <div className="space-y-6 select-text">
          <div className="space-y-3">
            <SectionHeader
              title="Kept Features in Validated Dataset"
              subtitle="High-quality, non-redundant, leak-free feature matrix"
              badgeText={`${keptFeatures.length} Kept`}
            />
            {keptFeatures.length === 0 ? (
              <div className="text-xs text-muted-foreground italic p-3 border border-border rounded">
                No features recorded in kept set.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 bg-surface-muted border border-border rounded">
                {keptFeatures.map((name: string, idx: number) => (
                  <span
                    key={idx}
                    className="font-mono text-xs px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded font-medium"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {droppedFeatures.length > 0 && (
            <div className="space-y-3">
              <SectionHeader
                title="Dropped Features & Remediation Rationale"
                subtitle="Features excluded due to leakage, high VIF, or collinearity"
                badgeText={`${droppedFeatures.length} Excluded`}
              />
              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-muted border-b border-border text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    <tr>
                      <th className="py-2 px-3">Feature Name</th>
                      <th className="py-2 px-3">Exclusion Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {droppedFeatures.map((df: any, idx: number) => (
                      <tr key={idx} className="hover:bg-surface-muted/30">
                        <td className="py-2 px-3 font-mono font-medium text-rose-600 dark:text-rose-400">{df.featureName}</td>
                        <td className="py-2 px-3">
                          <Badge variant="error">{df.reason}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
