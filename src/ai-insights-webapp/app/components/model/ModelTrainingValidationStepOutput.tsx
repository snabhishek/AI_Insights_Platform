"use client";

import React from "react";

const SECTIONS = [
  ["Model Training", "modelTraining"],
  ["Model Evaluation", "modelEvaluation"],
  ["Model Validation", "modelValidation"],
  ["Model Selection", "modelSelection"],
] as const;

export default function ModelTrainingValidationStepOutput({ stageOutputs }: { stageOutputs: Record<string, unknown> }) {
  return <div className="space-y-4">{SECTIONS.map(([title, key]) => {
    const output = stageOutputs[key] as Record<string, unknown> | undefined;
    const details = output ? Object.entries(output).filter(([name]) => !["status", "summary"].includes(name)) : [];
    return <section key={key} className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-foreground">{title}</h3><span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{String(output?.status || "Not Started")}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{String(output?.summary || "No output available yet.")}</p>
      {details.length > 0 && <dl className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{details.map(([name, value]) => <div key={name} className="min-w-0 rounded-lg bg-surface-muted p-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{name.replace(/([A-Z])/g, " $1")}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</dd></div>)}</dl>}
    </section>;
  })}</div>;
}
