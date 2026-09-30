import React from "react";

// ─── Connector icons from @dev.icons/react ───────────────────────────────────
export {
  Postgresql as PostgresqlIcon,
  MysqlIcon,
  MicrosoftAzure as SqlServerIcon,
  SnowflakeIcon,
  Swagger as RestApiIcon,
  AwsS3 as S3Icon,
  Mongodb as MongodbIcon,
} from "@dev.icons/react";

// Excel: Custom file icon in green
export const ExcelIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 128 128"
    width="48"
    height="48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M26 14h52l32 32v68a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"
      fill="#107C41"
      fillOpacity="0.12"
      stroke="#107C41"
      strokeWidth="4.5"
    />
    <path
      d="M78 14v32h32"
      stroke="#107C41"
      strokeWidth="4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Grid icon representing Excel sheets */}
    <path
      d="M38 60h40M38 76h40M38 92h40M54 60v32"
      stroke="#107C41"
      strokeWidth="4.5"
      strokeLinecap="round"
    />
  </svg>
);

// CSV: Custom file icon in blue
export const CsvIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 128 128"
    width="48"
    height="48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M26 14h52l32 32v68a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"
      fill="#007ACC"
      fillOpacity="0.12"
      stroke="#007ACC"
      strokeWidth="4.5"
    />
    <path
      d="M78 14v32h32"
      stroke="#007ACC"
      strokeWidth="4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* CSV letters */}
    <path
      d="M40 70c-2-2-5-2-7 0s-2 5 0 7 5 2 7 0M48 68c2 0 4 2 2 4s-4 2-2 4M56 70l6 14M68 70l-6 14"
      stroke="#007ACC"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// TSV: Custom file icon in orange
export const TsvIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 128 128"
    width="48"
    height="48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M26 14h52l32 32v68a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"
      fill="#D35400"
      fillOpacity="0.12"
      stroke="#D35400"
      strokeWidth="4.5"
    />
    <path
      d="M78 14v32h32"
      stroke="#D35400"
      strokeWidth="4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* TSV letters */}
    <path
      d="M38 70h12M44 70v14M54 70c2 0 4 2 2 4s-4 2-2 4M62 70l6 14M74 70l-6 14"
      stroke="#D35400"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ─── Asset icons (table, view, pipeline) ──────────────────────────────────────

export const TableIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3 3h18v18H3zM3 9h18M3 15h18M12 3v18" />
  </svg>
);

export const ViewIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const PipelineIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M6 9v7a3 3 0 0 0 3 3h6" />
    <path d="M18 15V9" />
    <circle cx="18" cy="6" r="3" />
  </svg>
);

// ─── Health overview sidebar icons ────────────────────────────────────────────

export const TotalSourcesIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-primary"
    {...props}
  >
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

export const ConnectedIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="#22c55e"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const SyncingIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="#3b82f6"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
  </svg>
);

export const IssuesIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="#ef4444"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
