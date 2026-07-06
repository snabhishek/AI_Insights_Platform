"use client";

import React, { useState, useEffect } from "react";
import {
  TotalSourcesIcon,
  ConnectedIcon,
  SyncingIcon,
  IssuesIcon,
} from "./Icons";
import { useApp } from "../providers/AppContext";

export default function DataHealthOverview() {
  const { dataSources, syncAllDataSources, isSyncingAll } = useApp();
  const [currentPercent, setCurrentPercent] = useState(0);

  // Radial Progress parameters:
  const radius = 45;
  const strokeWidth = 5; 
  const circumference = 2 * Math.PI * radius;

  // Calculate dynamic stats
  const totalCount = dataSources.length;
  const connectedCount = dataSources.filter((ds) => ds.status === "Connected").length;
  const syncingCount = dataSources.filter((ds) => ds.status === "Syncing").length;
  const issuesCount = dataSources.filter(
    (ds) => ds.status === "Connected" && (ds.health === "Warning" || ds.health === "Error")
  ).length;
  const healthyCount = dataSources.filter(
    (ds) => ds.status === "Connected" && ds.health === "Healthy"
  ).length;

  const targetPercent =
    totalCount > 0 && connectedCount > 0
      ? Math.round((healthyCount / connectedCount) * 100)
      : 100;

  useEffect(() => {
    const duration = 1000; // 1 second animation
    const startTime = performance.now();
    const startPercent = currentPercent;
    const deltaPercent = targetPercent - startPercent;

    let frameId: number;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progressRatio = Math.min(elapsed / duration, 1);
      
      const ease = progressRatio * (2 - progressRatio);
      
      const val = Math.round(startPercent + ease * deltaPercent);
      setCurrentPercent(val);

      if (progressRatio < 1) {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [targetPercent]);

  const strokeDashoffset = circumference - (currentPercent / 100) * circumference;

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-soft hover:shadow-soft-hover transition-shadow duration-300 h-full justify-between">
      <h3 className="text-base font-semibold text-foreground mb-4">
        Data Health Overview
      </h3>

      <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center justify-between gap-6 xl:gap-8 flex-1">
        {/* Radial gauge chart */}
        <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
          <svg className="w-full h-full" viewBox="0 0 120 120">
            {/* Background track circle */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              className="stroke-surface-muted"
              strokeWidth={strokeWidth}
              fill="transparent"
              transform="rotate(-90 60 60)"
            />
            {/* Active progress circle */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              className="stroke-primary"
              strokeWidth={strokeWidth}
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
            />
          </svg>
          {/* Centered label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="text-3xl font-bold text-foreground">{currentPercent}%</span>
            <span className="text-xs font-semibold text-green-500 mt-1">Healthy</span>
          </div>
        </div>

        {/* Legend / Metrics List */}
        <div className="w-full flex-1 flex flex-col gap-3 justify-center min-w-[150px]">
          {/* Total Sources */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary/5 text-primary">
                <TotalSourcesIcon />
              </span>
              <span>Total Sources</span>
            </div>
            <span className="font-semibold text-foreground text-right w-8">{totalCount}</span>
          </div>

          {/* Connected */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-green-500/5 text-green-500">
                <ConnectedIcon />
              </span>
              <span>Connected</span>
            </div>
            <span className="font-semibold text-foreground text-right w-8">{connectedCount}</span>
          </div>

          {/* Syncing */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md bg-blue-500/5 text-blue-500 ${syncingCount > 0 ? "animate-spin" : ""}`}>
                <SyncingIcon />
              </span>
              <span>Syncing</span>
            </div>
            <span className="font-semibold text-foreground text-right w-8">{syncingCount}</span>
          </div>

          {/* Issues */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-red-500/5 text-red-500">
                <IssuesIcon />
              </span>
              <span>Issues</span>
            </div>
            <span className="font-semibold text-foreground text-right w-8">{issuesCount}</span>
          </div>
        </div>
      </div>

      {/* Sync Footer */}
      <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs w-full">
        <span className="text-muted-foreground">Catalog state sync</span>
        <button
          type="button"
          onClick={syncAllDataSources}
          disabled={isSyncingAll || totalCount === 0}
          className="flex items-center gap-1.5 font-semibold text-primary hover:text-white hover:bg-primary border border-primary/20 px-2 py-1 rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:scale-100 disabled:hover:bg-transparent disabled:hover:text-primary active:scale-95 text-[11px]"
        >
          <span className={isSyncingAll ? "animate-spin" : ""}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </span>
          <span>{isSyncingAll ? "Syncing..." : "Sync All"}</span>
        </button>
      </div>
    </div>
  );
}
