"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { LineChart } from "@mui/x-charts/LineChart";
import { CandidateModelValidationRun } from "./ModelValidationStepOutput";

interface ModelValidationMUIChartProps {
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

export default function ModelValidationMUIChart({
  candidates,
  activeCandidate,
  championModelId,
  frequency = "Weekly",
  isClassification = false,
}: ModelValidationMUIChartProps) {
  // View mode: 'single' (focused active model) or 'compare' (all candidate models overlaid)
  const [viewMode, setViewMode] = useState<"single" | "compare">("single");

  // Aggregation method: 'sum' (total per date period) | 'mean' (average per date period) | 'raw' (each test record sequentially)
  const [aggregationMode, setAggregationMode] = useState<"sum" | "mean" | "raw">("sum");

  // Curve style: 'monotoneX' (strictly monotonic, no loops) | 'linear'
  const [curveType, setCurveType] = useState<"monotoneX" | "linear">("monotoneX");

  // ─── Data Extraction & Multi-Record Date Aggregation ─────────────────────────
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
        hasDuplicates: false,
        uniqueDateCount: 0,
        rawLength: 0,
        dates: [],
        actuals: [],
        forecasts: [],
        candidateForecastsMap: {},
      };
    }

    // Check if there are repeated timestamps in the validation evaluation dataset
    const dateCounts: Record<string, number> = {};
    rawDates.forEach((d) => {
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    });
    const uniqueDatesList = Object.keys(dateCounts);
    const hasDuplicates = uniqueDatesList.length < rawLength;

    // Build candidate predictions raw map
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

    // If 'raw' mode is selected or no duplicates exist, format sequentially
    if (aggregationMode === "raw" || (!hasDuplicates && aggregationMode === "sum")) {
      const formattedDates = rawDates.map((d, idx) =>
        hasDuplicates ? `${d} (#${idx + 1})` : d
      );

      return {
        hasDuplicates,
        uniqueDateCount: uniqueDatesList.length,
        rawLength,
        dates: formattedDates,
        actuals: rawActuals,
        forecasts: rawForecasts,
        candidateForecastsMap: candRawForecasts,
      };
    }

    // Sort unique dates chronologically
    const sortedUniqueDates = [...uniqueDatesList].sort((a, b) => {
      const ta = new Date(a).getTime();
      const tb = new Date(b).getTime();
      if (!isNaN(ta) && !isNaN(tb)) return ta - tb;
      return a.localeCompare(b);
    });

    // Aggregate values per unique date period
    const aggregatedActuals: Array<number | null> = [];
    const aggregatedForecasts: number[] = [];
    const aggregatedCandMap: Record<string, number[]> = {};
    candidates.forEach((c) => {
      aggregatedCandMap[c.model_id || (c as any).modelId] = [];
    });

    sortedUniqueDates.forEach((d) => {
      // Find all row indices matching this date
      const indices: number[] = [];
      for (let i = 0; i < rawDates.length; i++) {
        if (rawDates[i] === d) indices.push(i);
      }

      // Aggregate Actuals
      const validActuals = indices
        .map((i) => rawActuals[i])
        .filter((v): v is number => v !== null && v !== undefined && !isNaN(v));

      if (validActuals.length === 0) {
        aggregatedActuals.push(null);
      } else {
        const sum = validActuals.reduce((a, b) => a + b, 0);
        aggregatedActuals.push(aggregationMode === "sum" ? sum : sum / validActuals.length);
      }

      // Aggregate Active Candidate Forecasts
      const validForecasts = indices
        .map((i) => rawForecasts[i])
        .filter((v): v is number => typeof v === "number" && !isNaN(v));

      if (validForecasts.length === 0) {
        aggregatedForecasts.push(0);
      } else {
        const sum = validForecasts.reduce((a, b) => a + b, 0);
        aggregatedForecasts.push(aggregationMode === "sum" ? sum : sum / validForecasts.length);
      }

      // Aggregate each candidate model's predictions
      candidates.forEach((c) => {
        const cId = c.model_id || (c as any).modelId;
        const cList = candRawForecasts[cId] || [];
        const vals = indices
          .map((i) => cList[i])
          .filter((v): v is number => typeof v === "number" && !isNaN(v));

        if (vals.length === 0) {
          aggregatedCandMap[cId].push(0);
        } else {
          const sum = vals.reduce((a, b) => a + b, 0);
          aggregatedCandMap[cId].push(aggregationMode === "sum" ? sum : sum / vals.length);
        }
      });
    });

    return {
      hasDuplicates,
      uniqueDateCount: sortedUniqueDates.length,
      rawLength,
      dates: sortedUniqueDates,
      actuals: aggregatedActuals,
      forecasts: aggregatedForecasts,
      candidateForecastsMap: aggregatedCandMap,
    };
  }, [activeCandidate, candidates, aggregationMode]);

  const totalPoints = processedData.dates.length;

  // Zoom range state: [startIndex, endIndex]
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, Math.max(0, totalPoints - 1)]);

  // Reset zoom when dataset or aggregation changes
  useEffect(() => {
    if (totalPoints > 0) {
      setZoomRange([0, totalPoints - 1]);
    }
  }, [totalPoints, aggregationMode]);

  const [startIdx, endIdx] = zoomRange;
  const visibleCount = Math.max(1, endIdx - startIdx + 1);

  // ─── Mouse Scroll, Touchpad Pinch Zoom & Drag-To-Pan Handlers ───────────────
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ isDragging: boolean; startX: number; initialRange: [number, number] }>({
    isDragging: false,
    startX: 0,
    initialRange: [0, Math.max(0, totalPoints - 1)],
  });
  const [isDraggingCursor, setIsDraggingCursor] = useState(false);

  const resetZoom = useCallback(() => {
    if (totalPoints > 0) {
      setZoomRange([0, totalPoints - 1]);
    }
  }, [totalPoints]);

  const handleZoomByDelta = useCallback(
    (delta: number, focalRatio: number = 0.5) => {
      if (totalPoints <= 2) return;
      setZoomRange(([currStart, currEnd]) => {
        const currentSpan = currEnd - currStart;
        const zoomStep = Math.max(1, Math.round(currentSpan * 0.15));

        if (delta < 0) {
          // Zoom IN
          if (currentSpan <= 2) return [currStart, currEnd];
          const leftChange = Math.round(zoomStep * focalRatio);
          const rightChange = zoomStep - leftChange;
          const nextStart = Math.min(currEnd - 2, currStart + leftChange);
          const nextEnd = Math.max(currStart + 2, currEnd - rightChange);
          return [Math.max(0, nextStart), Math.min(totalPoints - 1, nextEnd)];
        } else {
          // Zoom OUT
          const leftChange = Math.round(zoomStep * focalRatio);
          const rightChange = zoomStep - leftChange;
          const nextStart = Math.max(0, currStart - leftChange);
          const nextEnd = Math.min(totalPoints - 1, currEnd + rightChange);
          return [nextStart, nextEnd];
        }
      });
    },
    [totalPoints]
  );

  const handlePanByDelta = useCallback(
    (deltaX: number) => {
      if (totalPoints <= 2) return;
      setZoomRange(([currStart, currEnd]) => {
        const span = currEnd - currStart;
        if (span >= totalPoints - 1) return [0, totalPoints - 1];

        const shift = deltaX > 0 ? 1 : -1;
        if (shift > 0) {
          const nextEnd = Math.min(totalPoints - 1, currEnd + shift);
          const nextStart = Math.max(0, nextEnd - span);
          return [nextStart, nextEnd];
        } else {
          const nextStart = Math.max(0, currStart + shift);
          const nextEnd = Math.min(totalPoints - 1, nextStart + span);
          return [nextStart, nextEnd];
        }
      });
    },
    [totalPoints]
  );

  // Attach non-passive wheel event listener to chart container for smooth scroll zoom
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // If user scrolls over the chart, zoom in/out with scroll wheel or touchpad pinch
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const focalRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        handleZoomByDelta(e.deltaY, focalRatio);
      } else if (Math.abs(e.deltaX) > 0) {
        // Horizontal touchpad swipe pans the timeline
        e.preventDefault();
        handlePanByDelta(e.deltaX);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [handleZoomByDelta, handlePanByDelta]);

  // Click-and-drag to pan
  const onMouseDown = (e: React.MouseEvent) => {
    if (totalPoints <= 2) return;
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      initialRange: [...zoomRange],
    };
    setIsDraggingCursor(true);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current.isDragging || !chartContainerRef.current) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const deltaPx = e.clientX - dragRef.current.startX;
    const pixelsPerPoint = rect.width / totalPoints || 1;
    const shiftPoints = Math.round(-deltaPx / (pixelsPerPoint * 1.5));

    if (shiftPoints !== 0) {
      const [initStart, initEnd] = dragRef.current.initialRange;
      const span = initEnd - initStart;
      let nextStart = initStart + shiftPoints;
      let nextEnd = initEnd + shiftPoints;

      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = Math.min(totalPoints - 1, span);
      } else if (nextEnd > totalPoints - 1) {
        nextEnd = totalPoints - 1;
        nextStart = Math.max(0, totalPoints - 1 - span);
      }

      setZoomRange([nextStart, nextEnd]);
    }
  };

  const onMouseUpOrLeave = () => {
    if (dragRef.current.isDragging) {
      dragRef.current.isDragging = false;
      setIsDraggingCursor(false);
    }
  };

  // Slice visible dates
  const visibleDates = useMemo(() => {
    return processedData.dates.slice(startIdx, endIdx + 1);
  }, [processedData.dates, startIdx, endIdx]);

  // Construct series based on Single vs Multi-Model Comparison
  const series = useMemo(() => {
    if (totalPoints === 0) return [];

    const visibleActuals = processedData.actuals.slice(startIdx, endIdx + 1);

    const actualSeriesItem = {
      id: "actual",
      data: visibleActuals,
      label: "Actual (Ground Truth)",
      color: "#10b981", // Emerald
      curve: curveType,
      connectNulls: true,
      showMark: true,
    };

    if (viewMode === "single") {
      const visibleForecasts = processedData.forecasts.slice(startIdx, endIdx + 1);
      const activeModelLabel = activeCandidate?.displayName || activeCandidate?.model_id || "Forecast";

      return [
        actualSeriesItem,
        {
          id: "forecast",
          data: visibleForecasts,
          label: `Forecast (${activeModelLabel})`,
          color: "#38bdf8", // Sky Blue
          curve: curveType,
          showMark: true,
        },
      ];
    }

    // Compare All Models Mode
    const candidateSeriesList = candidates.map((cand, idx) => {
      const candId = cand.model_id || (cand as any).modelId || `cand-${idx}`;
      const forecastsList = processedData.candidateForecastsMap[candId] || [];
      const visibleCandForecasts = forecastsList.slice(startIdx, endIdx + 1);
      const isChampion = candId === championModelId;
      const isSelected = candId === (activeCandidate?.model_id || (activeCandidate as any)?.modelId);

      let color = PALETTE[idx % PALETTE.length];
      if (isChampion) color = "#f59e0b"; // Gold for champion
      else if (isSelected) color = "#38bdf8";

      return {
        id: candId,
        data: visibleCandForecasts,
        label: `${cand.displayName || candId}${isChampion ? " ★" : ""}`,
        color,
        curve: curveType,
        showMark: visibleCandForecasts.length <= 30,
      };
    });

    return [actualSeriesItem, ...candidateSeriesList];
  }, [
    processedData,
    candidates,
    activeCandidate,
    championModelId,
    viewMode,
    curveType,
    startIdx,
    endIdx,
    totalPoints,
  ]);

  if (totalPoints === 0) {
    return (
      <div className="p-8 text-center text-xs text-muted-foreground bg-surface-muted/30 rounded-xl border border-border/50">
        No time-series data points available to display.
      </div>
    );
  }

  const isZoomed = startIdx > 0 || endIdx < totalPoints - 1;

  return (
    <div className="space-y-3">
      {/* ─── Top Control Toolbar: View Toggle, Aggregation, and Window Info ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-border/60 text-xs">
        {/* Left: View Mode & Aggregation Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode */}
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

          {/* Aggregation Mode (Sum / Average / Raw Records) */}
          {processedData.hasDuplicates && (
            <div className="flex items-center gap-1 p-1 bg-surface-raised border border-border rounded-xl">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground px-1.5">
                Metric:
              </span>
              <button
                type="button"
                onClick={() => setAggregationMode("sum")}
                className={`px-2.5 py-0.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  aggregationMode === "sum"
                    ? "bg-primary/20 text-primary border border-primary/30 font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Sum total actual and predicted values for each date period"
              >
                Total (Sum)
              </button>
              <button
                type="button"
                onClick={() => setAggregationMode("mean")}
                className={`px-2.5 py-0.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  aggregationMode === "mean"
                    ? "bg-primary/20 text-primary border border-primary/30 font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Average actual and predicted values for each date period"
              >
                Average (Mean)
              </button>
              <button
                type="button"
                onClick={() => setAggregationMode("raw")}
                className={`px-2.5 py-0.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  aggregationMode === "raw"
                    ? "bg-primary/20 text-primary border border-primary/30 font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="View all individual records sequentially"
              >
                Raw ({processedData.rawLength})
              </button>
            </div>
          )}

          {/* Curve Interpolation Toggle */}
          <div className="flex items-center gap-1 p-1 bg-surface-raised border border-border rounded-xl">
            <button
              type="button"
              onClick={() => setCurveType(curveType === "monotoneX" ? "linear" : "monotoneX")}
              className="px-2 py-0.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
              title="Toggle between Smooth (Monotone) and Linear interpolation"
            >
              {curveType === "monotoneX" ? "Smooth" : "Linear"}
            </button>
          </div>
        </div>

        {/* Right: Zoom Window Information & Mouse Gesture Hint */}
        <div className="flex items-center gap-2">
          {totalPoints > 2 && (
            <span className="hidden sm:inline-flex text-[11px] text-muted-foreground items-center gap-1 bg-muted/40 px-2 py-0.5 rounded border border-border/40">
              <span className="text-[10px]">💡</span> Scroll / Pinch to Zoom • Drag to Pan
            </span>
          )}

          <span className="text-[11px] font-mono text-muted-foreground bg-surface-raised px-2.5 py-1 rounded-lg border border-border">
            Window: <span className="font-semibold text-foreground">{visibleDates[0]}</span> &rarr;{" "}
            <span className="font-semibold text-foreground">{visibleDates[visibleDates.length - 1]}</span> (
            <span className="font-semibold text-primary">{visibleCount}</span>/{totalPoints} periods)
          </span>

          {isZoomed && (
            <button
              type="button"
              onClick={resetZoom}
              className="px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-semibold text-[11px] transition cursor-pointer"
            >
              Reset Zoom
            </button>
          )}
        </div>
      </div>

      {/* ─── Interactive MUI Line Chart Container (Mouse Scroll / Pinch / Drag Active) ─── */}
      <div
        ref={chartContainerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUpOrLeave}
        onMouseLeave={onMouseUpOrLeave}
        onDoubleClick={resetZoom}
        className={`w-full bg-surface-raised/40 rounded-xl p-2 border border-border/70 overflow-hidden select-none transition-shadow ${
          isDraggingCursor ? "cursor-grabbing ring-1 ring-primary/40" : "cursor-grab"
        }`}
        title="Mouse Scroll or Touchpad Pinch to Zoom In/Out • Click & Drag to Pan • Double-click to Reset"
      >
        <LineChart
          xAxis={[
            {
              scaleType: "point",
              data: visibleDates,
              tickLabelStyle: {
                fontSize: 11,
                fill: "var(--muted-foreground, #94a3b8)",
              },
            },
          ]}
          yAxis={[
            {
              tickLabelStyle: {
                fontSize: 11,
                fill: "var(--muted-foreground, #94a3b8)",
              },
              valueFormatter: (v: number | null) => (v !== null && !isNaN(v) ? formatNumber(v, 1) : ""),
            },
          ]}
          series={series as any}
          height={320}
          grid={{ horizontal: true }}
          slotProps={{
            legend: {
              direction: "horizontal",
              position: { vertical: "top", horizontal: "end" },
            },
          }}
          sx={{
            "& .MuiChartsGrid-line": {
              stroke: "var(--border, rgba(148, 163, 184, 0.15))",
              strokeDasharray: "3 3",
            },
            "& .MuiChartsAxis-line": {
              stroke: "var(--border, rgba(148, 163, 184, 0.3))",
            },
            "& .MuiChartsAxis-tick": {
              stroke: "var(--border, rgba(148, 163, 184, 0.3))",
            },
            "& .MuiChartsLegend-root": {
              fontSize: "12px",
            },
            "& .MuiChartsLegend-series text": {
              fill: "var(--foreground, #e2e8f0) !important",
            },
          }}
        />
      </div>
    </div>
  );
}
