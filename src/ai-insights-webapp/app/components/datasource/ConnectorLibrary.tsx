"use client";

import React from "react";
import {
  PostgresqlIcon,
  MysqlIcon,
  SqlServerIcon,
  SnowflakeIcon,
  MongodbIcon,
  RestApiIcon,
} from "./Icons";
import Image from "next/image";
import { DataSource } from "../providers/AppContext";

interface Connector {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const CONNECTORS: Connector[] = [
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Connect to PostgreSQL databases",
    icon: <PostgresqlIcon size={48} />,
  },
  {
    id: "mysql",
    name: "MySQL",
    description: "Connect to MySQL databases",
    icon: <MysqlIcon size={48} />,
  },
  {
    id: "sqlserver",
    name: "SQL Server",
    description: "Connect to Microsoft SQL Server",
    icon: <SqlServerIcon size={48} />,
  },
  {
    id: "snowflake",
    name: "Snowflake",
    description: "Connect to Snowflake Warehouse",
    icon: <SnowflakeIcon size={48} />,
  },
  {
    id: "mongodb",
    name: "MongoDB",
    description: "Connect to MongoDB databases",
    icon: <MongodbIcon size={48} />,
  },
  {
    id: "excel",
    name: "Excel",
    description: "Connect to Excel spreadsheets",
    icon: <Image src="/images/microsoft-excel.jpg" alt="Excel" width={48} height={48} className="object-contain" />,
  },
  {
    id: "csv",
    name: "CSV",
    description: "Upload and connect CSV files",
    icon: <Image src="/images/csv.png" alt="CSV" width={48} height={48} className="object-contain" />,
  },
  {
    id: "restapi",
    name: "REST API",
    description: "Connect to REST APIs",
    icon: <RestApiIcon size={48} />,
  },
];

interface ConnectorLibraryProps {
  onSelectConnector: (type: DataSource["type"]) => void;
}

export default function ConnectorLibrary({ onSelectConnector }: ConnectorLibraryProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-soft hover:shadow-soft-hover transition-shadow duration-300 h-full">
      {/* Header section with view all link */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-base font-semibold text-foreground">
          Connector Library
        </h3>
        <a
          href="#"
          className="text-xs font-bold text-blue-900 flex items-center gap-1 transition-colors"
        >
          <span>View All Connectors</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </a>
      </div>

      {/* Flex-wrap row — cards are fixed 150×216, wrap on smaller screens */}
      <div className="flex flex-wrap gap-3.5">
        {CONNECTORS.map((connector) => (
          <div
            key={connector.id}
            style={{ width: 153, height: 216 }}
            className="group flex flex-col items-center justify-between rounded-xl border border-border bg-surface p-4 text-center hover-lift duration-300 hover:border-primary/30 shrink-0"
          >
            {/* Connector Icon */}
            <div className="flex items-center justify-center p-2 rounded-lg bg-surface-muted transition-colors group-hover:bg-primary/5">
              {connector.icon}
            </div>

            {/* Title & Desc */}
            <div className="mt-2 flex flex-col flex-1 justify-center">
              <span className="text-sm font-semibold text-foreground tracking-tight">
                {connector.name}
              </span>
              <p className="text-[11px] text-muted-foreground leading-normal mt-1 max-h-[32px] overflow-hidden text-ellipsis line-clamp-2">
                {connector.description}
              </p>
            </div>

            {/* Action Connect Button */}
            <button
              type="button"
              onClick={() => onSelectConnector(connector.id as DataSource["type"])}
              className="mt-3.5 w-full bg-primary text-white text-xs font-semibold py-1.5 px-3 rounded-md cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              Connect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
