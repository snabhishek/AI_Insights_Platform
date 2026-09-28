"use client";

import React, { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { CandidateModelValidationRun } from "./ModelValidationStepOutput";

// Dynamically import ReactApexChart with SSR disabled for Next.js
const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
  loading: () => (
    <div className="h-[350px] w-full flex items-center justify-center text-xs text-muted-foreground bg-surface-muted/20 rounded-xl">
      <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin mr-2" />
      Loading ApexChart...
    </div>
  ),
});

interface ModelValidationApexChartProps {
  candidates: CandidateModelValidationRun[];
  activeCandidate: CandidateModelValidationRun | null;
  championModelId?: string | null;
  frequency?: string;
  isClassification?: boolean;
}

const PALETTE = [
  "#38bdf8", // Sky Blue
  "#f59e0b", // Amber / Gold (Champion)
  "#818cf8", // Indigo
  "#ec4899", // Pink
  "#14b8a6", // Teal
  "#a855f7", // Purple
  "#fb923c", // Orange
  "#06b6d4", // Cyan
];

function formatNumber(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(decimals)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(decimals)}K`;
  return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export default function ModelValidationApexChart({
  candidates,
  activeCandidate,
  championModelId,
  frequency = "Weekly",
  isClassification = false,
}: ModelValidationApexChartProps) {
  // View mode: 'single' (focused active model) or 'compare' (all candidate models overlaid)
  const [viewMode, setViewMode] = useState<"single" | "compare">("single");

  // ─── Extract Raw Data & Build Zoomable Timeseries ──────────────────────────
  const processedData = useMemo(() => {
    const cand = activeCandidate || candidates[0];
    const raw =
      cand?.chartData ||
      (cand as any)?.chart_data ||
      (cand as any)?.plotData ||
      (cand as any)?.plot_data ||
      (cand as any)?.predictions_chart;

    const rawDates: string[] = raw?.dates || (raw as any)?.timestamps || (raw as any)?.time || [];
    const rawActuals: Array<number | null> =
      raw?.actualSeries ||
      (raw as any)?.actual_series ||
      (raw as any)?.actuals ||
      (raw as any)?.actual ||
      [];
    const rawForecasts: number[] =
      raw?.predictedSeries ||
      (raw as any)?.predicted_series ||
      (raw as any)?.forecasts ||
      (raw as any)?.forecast ||
      (raw as any)?.predictions ||
      [];

    const rawLength = rawDates.length;
    if (rawLength === 0) {
      return {
        rawLength: 0,
        rawDates: [],
        series: [],
        isDatetime: false,
      };
    }

    // Check if dates are unique and valid ISO dates
    const uniqueDatesCount = new Set(rawDates).size;
    const hasUniqueDates = uniqueDatesCount === rawLength;
    const firstDateMs = new Date(rawDates[0]).getTime();
    const isDatetime = hasUniqueDates && !isNaN(firstDateMs);

    // Build raw predictions map for all candidate models
    const candRawForecasts: Record<string, number[]> = {};
    candidates.forEach((c) => {
      const cId = c.model_id || (c as any).modelId;
      const cRaw =
        c.chartData ||
        (c as any)?.chart_data ||
        (c as any)?.plotData ||
        (c as any)?.plot_data;
      candRawForecasts[cId] =
        cRaw?.predictedSeries ||
        (cRaw as any)?.predicted_series ||
        (cRaw as any)?.forecasts ||
        (cRaw as any)?.forecast ||
        (cRaw as any)?.predictions ||
        [];
    });

    // Populate data points
    const actualSeriesData: Array<{ x: number; y: number | null }> = [];
    const forecastSeriesData: Array<{ x: number; y: number | null }> = [];
    const candSeriesDataMap: Record<string, Array<{ x: number; y: number | null }>> = {};

    candidates.forEach((c) => {
      candSeriesDataMap[c.model_id || (c as any).modelId] = [];
    });

    for (let idx = 0; idx < rawLength; idx++) {
      // Use timestamp if unique datetime, otherwise numeric index (1..N) to ensure full zoomability
      const xVal = isDatetime ? new Date(rawDates[idx]).getTime() : idx + 1;
      const actualVal =
        rawActuals[idx] !== undefined && rawActuals[idx] !== null && !isNaN(rawActuals[idx]!)
          ? rawActuals[idx]
          : null;
      const forecastVal =
        typeof rawForecasts[idx] === "number" && !isNaN(rawForecasts[idx])
          ? rawForecasts[idx]
          : null;

      actualSeriesData.push({ x: xVal, y: actualVal });
      forecastSeriesData.push({ x: xVal, y: forecastVal });

      candidates.forEach((c) => {
        const cId = c.model_id || (c as any).modelId;
        const cList = candRawForecasts[cId] || [];
        const cVal =
          typeof cList[idx] === "number" && !isNaN(cList[idx]) ? cList[idx] : null;
        candSeriesDataMap[cId].push({ x: xVal, y: cVal });
      });
    }

    const actualSeries = {
      name: "Actual (Ground Truth)",
      data: actualSeriesData,
    };

    if (viewMode === "single") {
      const activeName = activeCandidate?.displayName || activeCandidate?.model_id || "Forecast";
      return {
        rawLength,
        rawDates,
        isDatetime,
        series: [
          actualSeries,
          {
            name: `Forecast (${activeName})`,
            data: forecastSeriesData,
          },
        ],
      };
    }

    // Compare All Models Mode
    const compareSeries = candidates.map((cand, idx) => {
      const candId = cand.model_id || (cand as any).modelId;
      const isChampion = candId === championModelId;
      return {
        name: `${cand.displayName || candId}${isChampion ? " ★" : ""}`,
        data: candSeriesDataMap[candId] || [],
      };
    });

    return {
      rawLength,
      rawDates,
      isDatetime,
      series: [actualSeries, ...compareSeries],
    };
  }, [activeCandidate, candidates, championModelId, viewMode]);

  // ─── ApexCharts Options Configuration ───────────────────────────────────────
  const chartOptions: ApexCharts.ApexOptions = useMemo(() => {
    // Determine colors
    const colors =
      viewMode === "single"
        ? ["#10b981", "#38bdf8"]
        : [
            "#10b981",
            ...candidates.map((c, i) =>
              c.model_id === championModelId ? "#f59e0b" : PALETTE[i % PALETTE.length]
            ),
          ];

    // Dash array: Actual is dashed (5), Forecasts are solid (0)
    const strokeDashArray =
      viewMode === "single" ? [5, 0] : [5, ...candidates.map(() => 0)];

    const { rawDates, isDatetime } = processedData;

    return {
      chart: {
        type: "line",
        height: 350,
        stacked: false,
        background: "transparent",
        zoom: {
          type: "x",
          enabled: true,
          autoScaleYaxis: true,
        },
        toolbar: {
          show: true,
          autoSelected: "zoom",
          tools: {
            download: true,
            selection: true,
            zoom: true,
            zoomin: true,
            zoomout: true,
            pan: true,
            reset: true,
          },
        },
        animations: {
          enabled: true,
          easing: "easeinout",
          speed: 400,
        },
      },
      colors,
      dataLabels: {
        enabled: false,
      },
      stroke: {
        curve: "smooth",
        width: 2.5,
        dashArray: strokeDashArray,
      },
      markers: {
        size: processedData.rawLength <= 30 ? 4 : 0,
        hover: {
          size: 6,
        },
      },
      grid: {
        borderColor: "rgba(148, 163, 184, 0.15)",
        strokeDashArray: 3,
        xaxis: {
          lines: {
            show: false,
          },
        },
        yaxis: {
          lines: {
            show: true,
          },
        },
      },
      xaxis: {
        // Use 'datetime' if unique dates, or 'numeric' with index lookup so zooming ALWAYS works
        type: isDatetime ? "datetime" : "numeric",
        tickAmount: Math.min(10, processedData.rawLength),
        labels: {
          style: {
            colors: "#94a3b8",
            fontSize: "11px",
          },
          datetimeUTC: false,
          formatter: (val: string) => {
            if (isDatetime) return val;
            const numericVal = parseFloat(val);
            if (isNaN(numericVal)) return val;
            const idx = Math.round(numericVal) - 1;
            return rawDates[idx] ? rawDates[idx] : `#${Math.round(numericVal)}`;
          },
        },
        axisBorder: {
          color: "rgba(148, 163, 184, 0.2)",
        },
        axisTicks: {
          color: "rgba(148, 163, 184, 0.2)",
        },
      },
      yaxis: {
        labels: {
          style: {
            colors: "#94a3b8",
            fontSize: "11px",
          },
          formatter: (val: number) =>
            val !== null && !isNaN(val) ? formatNumber(val, 1) : "",
        },
      },
      tooltip: {
        theme: "dark",
        shared: true,
        intersect: false,
        x: {
          formatter: (val: number) => {
            if (isDatetime) {
              const d = new Date(val);
              return !isNaN(d.getTime()) ? d.toLocaleDateString() : `${val}`;
            }
            const idx = Math.round(val) - 1;
            return rawDates[idx]
              ? `Record #${Math.round(val)} • ${rawDates[idx]}`
              : `Record #${Math.round(val)}`;
          },
        },
        y: {
          formatter: (val: number) =>
            val !== null && !isNaN(val) ? formatNumber(val, 2) : "N/A",
        },
      },
      legend: {
        show: true,
        position: "top",
        horizontalAlign: "right",
        labels: {
          colors: "#e2e8f0",
        },
        itemMargin: {
          horizontal: 10,
          vertical: 4,
        },
      },
    };
  }, [viewMode, candidates, championModelId, processedData]);

  if (processedData.series.length === 0 || processedData.rawLength === 0) {
    return (
      <div className="p-8 text-center text-xs text-muted-foreground bg-surface-muted/30 rounded-xl border border-border/50">
        No time-series data points available to display.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ─── Top Control Toolbar: View Toggle & Interaction Guide ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-border/60 text-xs">
        {/* Left: View Mode Switcher */}
        <div className="flex items-center gap-1 p-1 bg-surface-raised border border-border rounded-xl">
          <button
            type="button"
            onClick={() => setViewMode("single")}
            className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
              viewMode === "single"
                ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active Model
          </button>
          {candidates.length > 1 && (
            <button
              type="button"
              onClick={() => setViewMode("compare")}
              className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                viewMode === "compare"
                  ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>Compare All ({candidates.length})</span>
            </button>
          )}
        </div>

        {/* Right: Record count & Zoom Help Tooltip */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground font-semibold bg-surface-raised px-2.5 py-1 rounded-lg border border-border">
            {processedData.rawLength} Raw Records
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 bg-muted/40 px-2.5 py-1 rounded-lg border border-border/40">
            <span>🔍</span> Click & drag box to zoom in • Click home icon to reset
          </span>
        </div>
      </div>

      {/* ─── ApexChart Zoomable Timeseries ─── */}
      <div className="w-full bg-surface-raised/40 rounded-xl p-3 border border-border/70 overflow-hidden">
        <ReactApexChart
          options={chartOptions}
          series={processedData.series as any}
          type="line"
          height={350}
        />
      </div>
    </div>
  );
}
