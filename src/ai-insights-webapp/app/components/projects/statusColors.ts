import type { PipelineStatus } from "./types";

export interface StatusColorTheme {
  cssVar: string;
  hex: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
}

export const STATUS_COLOR_CONFIG: Record<string, StatusColorTheme> = {
  "None": {
    cssVar: "--status-none",
    hex: "#596579",
    bgClass: "bg-status-none",
    borderClass: "border-status-none",
    textClass: "text-status-none",
  },
  "Pending": {
    cssVar: "--status-pending",
    hex: "#006D77",
    bgClass: "bg-status-pending",
    borderClass: "border-status-pending",
    textClass: "text-status-pending",
  },
  "In-Progress": {
    cssVar: "--status-in-progress",
    hex: "#4338CA",
    bgClass: "bg-status-in-progress",
    borderClass: "border-status-in-progress",
    textClass: "text-status-in-progress",
  },
  "Awaiting Approval": {
    cssVar: "--status-awaiting-approval",
    hex: "#6D28D9",
    bgClass: "bg-status-awaiting-approval",
    borderClass: "border-status-awaiting-approval",
    textClass: "text-status-awaiting-approval",
  },
  "User Input": {
    cssVar: "--status-user-input",
    hex: "#0369A1",
    bgClass: "bg-status-user-input",
    borderClass: "border-status-user-input",
    textClass: "text-status-user-input",
  },
  "Completed": {
    cssVar: "--status-completed",
    hex: "#047857",
    bgClass: "bg-status-completed",
    borderClass: "border-status-completed",
    textClass: "text-status-completed",
  },
  "Failed": {
    cssVar: "--status-failed",
    hex: "#de0b43;",
    bgClass: "bg-status-failed",
    borderClass: "border-status-failed",
    textClass: "text-status-failed",
  },
  "Stopped": {
    cssVar: "--status-stopped",
    hex: "#A21CAF",
    bgClass: "bg-status-stopped",
    borderClass: "border-status-stopped",
    textClass: "text-status-stopped",
  },
  "Paused": {
    cssVar: "--status-paused",
    hex: "#B45309",
    bgClass: "bg-status-paused",
    borderClass: "border-status-paused",
    textClass: "text-status-paused",
  },
};

export function getStatusColorTheme(status?: PipelineStatus | string | null): StatusColorTheme {
  if (!status) return STATUS_COLOR_CONFIG["None"];
  return STATUS_COLOR_CONFIG[status] ?? STATUS_COLOR_CONFIG["None"];
}
