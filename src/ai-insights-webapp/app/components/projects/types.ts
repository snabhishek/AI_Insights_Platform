// Shared types for the Projects feature

export type PipelineStatus = "Completed" | "In Progress" | "Pending" | "Not Started";
export type RunStatus = "Success" | "Running" | "Paused" | "Idle";

export type PipelineStatuses = Record<string, PipelineStatus>;

export interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  metric: string;
  color: "green" | "blue" | "purple" | "yellow" | "red" | "pink" | "teal";
  icon: React.ReactNode;
}
