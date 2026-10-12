"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Workflow } from "./types";
import "./SignalStrip.css";

export type StepStatus = "pending" | "running" | "done";

export interface StripStep {
  id: string;
  title: string;
  color: string;
}

export interface StripStage {
  id: string;
  label: string;
  color: string;
  steps: StripStep[];
}

export interface SignalStripProps {
  stages: StripStage[];
  /** Status keyed by step id; missing ids count as pending. */
  status: Record<string, StepStatus>;
  selectedId?: string;
  onSelect?: (stepId: string) => void;
  forecastLabel?: string;
  height?: number;
  className?: string;
}

/** Adapts PIPELINE_STEPS while allowing shorter labels for the strip. */
export function toStripStages(
  workflows: (Pick<Workflow, "id" | "title" | "color"> & {
    short?: string;
    step?: { id: string; title: string; color: string }[];
  })[]
): StripStage[] {
  return workflows.map((workflow) => ({
    id: workflow.id,
    label: workflow.short ?? workflow.title,
    color: workflow.color,
    steps: (workflow.step ?? []).map(({ id, title, color }) => ({ id, title, color })),
  }));
}

const FALLBACK: Record<string, string> = {
  green: "#12935f",
  blue: "#2563d9",
  purple: "#7444d1",
  teal: "#0a8f9c",
  pink: "#cf2f78",
  yellow: "#b27400",
};

const colorValue = (color: string) =>
  color.startsWith("#") ? color : `var(--${color}, ${FALLBACK[color] ?? "#2563d9"})`;

const smooth = (value: number) => value * value * (3 - 2 * value);

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface Flat extends StripStep {
  si: number;
  i: number;
  n: number;
}

function buildGeometry(width: number, height: number, flat: Flat[], stageCount: number) {
  const cy = height * 0.61;
  const amp = height / 2 - 14;
  const mainEnd = width * 0.87;
  const segment = mainEnd / stageCount;
  const dotX = flat.map((step) => step.si * segment + ((step.i + 0.5) / step.n) * segment);

  const sampleStep = 3;
  const sampleCount = Math.ceil(mainEnd / sampleStep) + 1;
  const random = rng(11);
  const raw: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    raw.push(random() * 2 - 1 + (random() < 0.07 ? (random() < 0.5 ? -1 : 1) * 1.7 : 0));
  }

  const points: [number, number][] = [];
  for (let i = 0; i < sampleCount; i++) {
    const x = Math.min(i * sampleStep, mainEnd);
    const progress = x / mainEnd;
    const windowSize = 1 + Math.round(progress * 14);
    let sum = 0;
    let count = 0;
    for (let offset = -windowSize; offset <= windowSize; offset++) {
      const index = i + offset;
      if (index >= 0 && index < sampleCount) {
        sum += raw[index];
        count++;
      }
    }
    const distance = dotX.length
      ? Math.min(...dotX.map((dot) => Math.abs(dot - x)))
      : 99;
    const taper = smooth(Math.min(1, Math.max(0, (distance - 11) / 26)));
    const endBlend = smooth(Math.min(1, (mainEnd - x) / 40));
    const y =
      cy +
      Math.max(
        -amp,
        Math.min(amp, (sum / count) * amp * 0.95 * (1 - progress * 0.72) * taper * endBlend)
      );
    points.push([x, y]);
  }

  const middle: [number, number][] = [];
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  const tailEnd = width - 6;
  for (let x = mainEnd; x <= tailEnd; x += 5) {
    const progress = (x - mainEnd) / (tailEnd - mainEnd);
    const wave = Math.sin(progress * 5.5) * 4 * progress;
    const halfWidth = progress * amp * 0.85;
    middle.push([x, cy + wave]);
    upper.push([x, cy + wave - halfWidth]);
    lower.push([x, cy + wave + halfWidth]);
  }

  const pathPoints = (items: [number, number][]) =>
    items.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");

  return {
    cy,
    mainEnd,
    segment,
    dotX,
    trace: `M${pathPoints(points)}`,
    tail: `M${pathPoints(middle)}`,
    band: `M${pathPoints(upper)} L${pathPoints(lower.reverse())} Z`,
  };
}

export function SignalStrip({
  stages,
  status,
  selectedId,
  onSelect,
  forecastLabel = "Forecast",
  height = 88,
  className = "",
}: SignalStripProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(() => setWidth(element.clientWidth));
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const flat = useMemo<Flat[]>(
    () =>
      stages.flatMap((stage, stageIndex) =>
        stage.steps.map((step, index) => ({
          ...step,
          si: stageIndex,
          i: index,
          n: stage.steps.length,
        }))
      ),
    [stages]
  );
  const geometry = useMemo(
    () => (width > 0 && stages.length > 0 ? buildGeometry(width, height, flat, stages.length) : null),
    [width, height, flat, stages.length]
  );

  const target = useMemo(() => {
    if (!geometry) return 0;
    const stepStatuses = flat.map((step) => status[step.id] ?? "pending");
    if (stepStatuses.length && stepStatuses.every((stepStatus) => stepStatus === "done")) return width;
    const runningIndex = stepStatuses.indexOf("running");
    if (runningIndex >= 0) return geometry.dotX[runningIndex];
    const lastDoneIndex = stepStatuses.lastIndexOf("done");
    return lastDoneIndex >= 0 ? geometry.dotX[lastDoneIndex] : 0;
  }, [geometry, flat, status, width]);

  const [progressX, setProgressX] = useState(0);
  const progressRef = useRef(0);
  useEffect(() => {
    let frameId = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      progressRef.current = target;
      frameId = requestAnimationFrame(() => setProgressX(target));
      return () => cancelAnimationFrame(frameId);
    }

    const tick = () => {
      const distance = target - progressRef.current;
      if (Math.abs(distance) < 0.5) {
        progressRef.current = target;
        setProgressX(target);
        return;
      }
      progressRef.current += distance * 0.14;
      setProgressX(progressRef.current);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target]);

  const lastStageIndex = stages.length - 1;
  const stops = stages.flatMap((stage, index) => {
    const start = geometry ? index * geometry.segment + (index ? 40 : 0) : 0;
    const end = geometry
      ? index < lastStageIndex
        ? (index + 1) * geometry.segment - 30
        : width
      : 0;
    return [
      { offset: start / (width || 1), color: stage.color },
      { offset: end / (width || 1), color: stage.color },
    ];
  });

  const layer = (strokeWidth: number, bandOpacity: number) =>
    geometry && (
      <>
        <path d={geometry.band} fill={`url(#g${uid})`} opacity={bandOpacity} />
        <path
          d={geometry.trace}
          fill="none"
          stroke={`url(#g${uid})`}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={geometry.tail}
          fill="none"
          stroke={`url(#g${uid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray="1 7"
        />
      </>
    );

  return (
    <div
      ref={ref}
      className={`ss ${className}`}
      style={{ height }}
      role="group"
      aria-label="Signal overview"
    >
      {geometry && (
        <>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            <defs>
              <linearGradient
                id={`g${uid}`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="0"
                x2={width}
                y2="0"
              >
                {stops.map((stop, index) => (
                  <stop
                    key={index}
                    offset={Math.min(1, Math.max(0, stop.offset))}
                    stopColor={colorValue(stop.color)}
                  />
                ))}
              </linearGradient>
              <clipPath id={`c${uid}`}>
                <rect x="0" y="0" width={progressX} height={height} />
              </clipPath>
            </defs>
            <g opacity=".28">{layer(1.4, 0.5)}</g>
            <g clipPath={`url(#c${uid})`}>{layer(2.6, 0.22)}</g>
          </svg>

          {stages.map((stage, index) => (
            <span
              key={stage.id}
              className="ss-label"
              style={
                {
                  left: index * geometry.segment + 10,
                  width: geometry.segment - 14,
                  "--c": colorValue(stage.color),
                } as CSSProperties
              }
            >
              {stage.label}
            </span>
          ))}
          <span
            className="ss-label ss-label-end"
            style={
              {
                left: geometry.mainEnd + 4,
                width: Math.max(0, width - geometry.mainEnd - 12),
                "--c": colorValue(stages[lastStageIndex]?.color ?? "pink"),
              } as CSSProperties
            }
          >
            {forecastLabel}
          </span>

          {flat.map((step, index) => (
            <button
              key={step.id}
              type="button"
              title={step.title}
              aria-label={step.title}
              aria-pressed={selectedId === step.id}
              className={`ss-dot${selectedId === step.id ? " is-selected" : ""}`}
              data-status={status[step.id] ?? "pending"}
              style={
                {
                  left: geometry.dotX[index],
                  top: geometry.cy,
                  "--c": colorValue(step.color),
                } as CSSProperties
              }
              onClick={() => onSelect?.(step.id)}
            >
              {index + 1}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export default SignalStrip;
