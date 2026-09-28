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
      Loading Validation Chart...
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

/**
 * Parses ISO week string (e.g. "2025-W36" or "2025W36") into UTC timestamp of Monday of that week.
 */
function parseIsoWeek(year: number, week: number): number {
  const simple = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = simple.getUTCDay() || 7;
  const mondayWeek1 = new Date(simple.getTime() - (dayOfWeek - 1) * 86400000);
  return mondayWeek1.getTime() + (week - 1) * 7 * 86400000;
}

/**
 * Parses any date/period format (Monthly "2025-09-01", Weekly "2025-09-08", Yearly "2025",
 * ISO Week "2025-W36", Quarter "2025-Q1", etc.) into a UTC timestamp.
 * Returns null for non-date periods (e.g. "P1", "Period 1", "Index 0").
 */
function parseDateToUtcTimestamp(dateStr: string): number | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();

  // If it's explicitly a period label like "P1", "Period 1", "Index 1", "T+1", "Step 1"
  if (/^(P\d+|Period\s*\d+|Index\s*\d+|T[+-]\d+|Step\s*\d+)$/i.test(trimmed)) {
    return null;
  }

  // Yearly format: "2025" or "2026"
  if (/^\d{4}$/.test(trimmed)) {
    const y = parseInt(trimmed, 10);
    return Date.UTC(y, 0, 1);
  }

  // ISO Week format: "2025-W36" or "2025W36"
  const weekMatch = trimmed.match(/^(\d{4})[-_]?W(\d{1,2})$/i);
  if (weekMatch) {
    const y = parseInt(weekMatch[1], 10);
    const w = parseInt(weekMatch[2], 10);
    return parseIsoWeek(y, w);
  }

  // Quarter format: "2025-Q3", "2025/Q3", "Q3 2025", "Q3-2025"
  const qMatch1 = trimmed.match(/^(\d{4})[-_ /]?Q([1-4])$/i);
  if (qMatch1) {
    const y = parseInt(qMatch1[1], 10);
    const q = parseInt(qMatch1[2], 10);
    return Date.UTC(y, (q - 1) * 3, 1);
  }
  const qMatch2 = trimmed.match(/^Q([1-4])[-_ /]?(\d{4})$/i);
  if (qMatch2) {
    const q = parseInt(qMatch2[1], 10);
    const y = parseInt(qMatch2[2], 10);
    return Date.UTC(y, (q - 1) * 3, 1);
  }

  // Year-Month format: "2025-09" or "2025/09"
  if (/^\d{4}[-/]\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split(/[-/]/);
    return Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
  }

  // Standard Year-Month-Day: "2025-09-01" or ISO timestamp
  const isoStr = trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00Z`;
  const parsed = Date.parse(isoStr);
  if (!isNaN(parsed)) return parsed;

  // Generic fallback parsing (e.g. "01 Sep 2025", "Sep 2025")
  const fallbackParsed = Date.parse(trimmed);
  return isNaN(fallbackParsed) ? null : fallbackParsed;
}

/**
 * Normalizes or detects frequency based on explicit configuration or date sequence spacing.
 */
function detectFrequency(
  dates: string[],
  explicitFreq?: string
): "monthly" | "weekly" | "yearly" | "daily" | "quarterly" | "period" {
  if (explicitFreq) {
    const f = explicitFreq.toLowerCase().trim();
    if (f.includes("month")) return "monthly";
    if (f.includes("week")) return "weekly";
    if (f.includes("year") || f.includes("annual")) return "yearly";
    if (f.includes("day") || f.includes("daily")) return "daily";
    if (f.includes("quarter")) return "quarterly";
    if (f.includes("period") || f.includes("step")) return "period";
  }

  if (!dates || dates.length < 2) return "monthly";

  // Check if all dates are year strings
  if (dates.every((d) => /^\d{4}$/.test(d.trim()))) return "yearly";

  // Check if dates contain ISO weeks
  if (dates.some((d) => /W\d{1,2}/i.test(d))) return "weekly";

  // Check if dates contain quarters
  if (dates.some((d) => /Q[1-4]/i.test(d))) return "quarterly";

  // Measure delta in days between first two parseable timestamps
  const ts1 = parseDateToUtcTimestamp(dates[0]);
  const ts2 = parseDateToUtcTimestamp(dates[1]);
  if (ts1 !== null && ts2 !== null) {
    const diffDays = Math.abs(ts2 - ts1) / (1000 * 60 * 60 * 24);
    if (diffDays >= 300) return "yearly";
    if (diffDays >= 60 && diffDays <= 120) return "quarterly";
    if (diffDays >= 20 && diffDays <= 35) return "monthly";
    if (diffDays >= 5 && diffDays <= 10) return "weekly";
    if (diffDays <= 2) return "daily";
  }

  return "monthly";
}

/**
 * Formats a UTC timestamp according to the given frequency (for axis ticks and tooltips).
 */
function formatTimestampByFrequency(
  timestamp: number,
  freq: "monthly" | "weekly" | "yearly" | "daily" | "quarterly" | "period",
  isTooltip = false
): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";

  switch (freq) {
    case "yearly":
      return isTooltip ? `Year ${d.getUTCFullYear()}` : `${d.getUTCFullYear()}`;
    case "quarterly": {
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      return isTooltip
        ? `Q${q} ${d.getUTCFullYear()} (${d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })})`
        : `Q${q} ${d.getUTCFullYear()}`;
    }
    case "monthly":
      return isTooltip
        ? d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) // e.g. "September 2025"
        : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }); // e.g. "Sep 2025"
    case "weekly":
      return isTooltip
        ? `Week of ${d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`
        : d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); // e.g. "01 Sep 2025"
    case "daily":
      return isTooltip
        ? d.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
        : d.toLocaleDateString("en-US", { day: "2-digit", month: "short", timeZone: "UTC" }); // e.g. "01 Sep"
    default:
      return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
}

export default function ModelValidationApexChart({
  candidates,
  activeCandidate,
  championModelId,
  frequency = "Monthly",
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
        activeFreq: "monthly" as const,
      };
    }

    // Determine if dates are calendar dates or period labels
    const parsedTimestamps = rawDates.map(parseDateToUtcTimestamp);
    const allValidDates = parsedTimestamps.every((ts) => ts !== null);
    const uniqueTimestamps = new Set(parsedTimestamps.filter((ts): ts is number => ts !== null));
    const isDatetime = allValidDates && uniqueTimestamps.size === rawLength;
    const activeFreq = detectFrequency(rawDates, frequency);

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

    // Populate series data points with UTC timestamps or sequential 1..N indices
    const actualSeriesData: Array<{ x: number; y: number | null }> = [];
    const forecastSeriesData: Array<{ x: number; y: number | null }> = [];
    const candSeriesDataMap: Record<string, Array<{ x: number; y: number | null }>> = {};

    candidates.forEach((c) => {
      candSeriesDataMap[c.model_id || (c as any).modelId] = [];
    });

    for (let idx = 0; idx < rawLength; idx++) {
      const xVal = isDatetime && parsedTimestamps[idx] !== null ? parsedTimestamps[idx]! : idx + 1;
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
        activeFreq,
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
      activeFreq,
      series: [actualSeries, ...compareSeries],
    };
  }, [activeCandidate, candidates, championModelId, viewMode, frequency]);

  // ─── ApexCharts Options Configuration ───────────────────────────────────────
  const chartOptions: ApexCharts.ApexOptions = useMemo(() => {
    const colors =
      viewMode === "single"
        ? ["#10b981", "#38bdf8"]
        : [
            "#10b981",
            ...candidates.map((c, i) =>
              c.model_id === championModelId ? "#f59e0b" : PALETTE[i % PALETTE.length]
            ),
          ];

    const strokeDashArray =
      viewMode === "single" ? [5, 0] : [5, ...candidates.map(() => 0)];

    const { rawDates, isDatetime, rawLength, activeFreq } = processedData;

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
        size: rawLength <= 30 ? 4 : 0,
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
        type: isDatetime ? "datetime" : "numeric",
        tickAmount: Math.min(10, Math.max(4, rawLength)),
        labels: {
          style: {
            colors: "#94a3b8",
            fontSize: "11px",
          },
          datetimeUTC: true,
          rotate: rawLength > 8 ? -30 : 0,
          rotateAlways: false,
          formatter: (val: string, timestamp?: number) => {
            if (isDatetime) {
              const rawTs =
                typeof timestamp === "number" && !isNaN(timestamp)
                  ? timestamp
                  : typeof val === "number"
                  ? (val as unknown as number)
                  : parseFloat(val);

              if (!isNaN(rawTs)) {
                return formatTimestampByFrequency(rawTs, activeFreq, false);
              }
              return val;
            }

            // Numeric sequence mapping for Period / Step labels (e.g. "P1", "Period 1")
            const num = typeof val === "number" ? (val as unknown as number) : parseFloat(val);
            if (isNaN(num)) return typeof val === "string" ? val : "";
            const idx = Math.round(num) - 1;
            return rawDates[idx] !== undefined ? rawDates[idx] : `P${Math.round(num)}`;
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
            if (isDatetime && typeof val === "number" && !isNaN(val)) {
              return formatTimestampByFrequency(val, activeFreq, true);
            }

            // Period / Record Index
            const idx = Math.round(val) - 1;
            if (rawDates[idx]) {
              const label = rawDates[idx];
              const isAlreadyPeriod = /period|p\d|step|horizon/i.test(label);
              return isAlreadyPeriod ? label : `${label} (Period ${Math.round(val)})`;
            }
            return `Period ${Math.round(val)}`;
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

  // Format capitalized frequency label for header badge (e.g. "Monthly", "Weekly", "Yearly", "Custom")
  const freqBadgeLabel =
    processedData.activeFreq.charAt(0).toUpperCase() + processedData.activeFreq.slice(1);

  return (
    <div className="space-y-3">
      {/* ─── Top Control Toolbar: View Toggle & Record Info ─── */}
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

        {/* Right: Period/Frequency Info & Zoom Help Note */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground font-semibold bg-surface-raised px-2.5 py-1 rounded-lg border border-border">
            {processedData.rawLength} {freqBadgeLabel} Periods
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 bg-muted/40 px-2.5 py-1 rounded-lg border border-border/40">
            <span>🔍</span> Drag box to zoom in • Click home icon to reset
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
