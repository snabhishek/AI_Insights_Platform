"use client";

import React, { useState, useEffect, useRef } from "react";
import { useApp } from "../providers/AppContext";

interface SystemLog {
  timestamp: string;
  level: "INFO" | "DEBUG" | "WARN" | "ERROR";
  message: string;
}

const MOCK_MESSAGES = [
  "Validated postgresql connection state: Healthy.",
  "Fetched metadata catalog schema for Snowflake Warehouse.",
  "Rate limits: 15% evaluation quota consumed.",
  "System cron triggered catalog state refresh.",
  "Token utilization computed: 14,203 tokens mapped.",
  "New project created: Q3 Financial audit by Santhosh.",
  "API gateway latency optimized: 124ms roundtrip.",
  "Saved local user configuration variables.",
  "Warning: connection time-out on secondary backup node.",
];

export default function AdminConfigPage() {
  const { systemRoles, togglePermission, addSystemRole } = useApp();
  const [newRoleName, setNewRoleName] = useState("");

  // Live Stats States
  const [cpu, setCpu] = useState(38);
  const [memory, setMemory] = useState(64);
  const [latency, setLatency] = useState(145);

  // Live Console Logs State
  const [logs, setLogs] = useState<SystemLog[]>([
    { timestamp: "15:47:02", level: "INFO", message: "AI Insights Admin Console Initialized." },
    { timestamp: "15:47:05", level: "DEBUG", message: "Established connection pool to ERP db." },
  ]);

  const logConsoleEndRef = useRef<HTMLDivElement>(null);

  // Fluctuating Stats Simulation
  useEffect(() => {
    const statsInterval = setInterval(() => {
      setCpu((prev) => Math.max(10, Math.min(95, prev + Math.floor(Math.random() * 11) - 5)));
      setMemory((prev) => Math.max(50, Math.min(88, prev + Math.floor(Math.random() * 5) - 2)));
      setLatency((prev) => Math.max(80, Math.min(300, prev + Math.floor(Math.random() * 31) - 15)));
    }, 2500);

    return () => clearInterval(statsInterval);
  }, []);

  // Live Log Stream Simulation
  useEffect(() => {
    const logInterval = setInterval(() => {
      const date = new Date();
      const timestamp = date.toTimeString().split(" ")[0];
      const randomMsg = MOCK_MESSAGES[Math.floor(Math.random() * MOCK_MESSAGES.length)];
      const levels: SystemLog["level"][] = ["INFO", "DEBUG", "WARN"];
      const randomLevel = levels[Math.floor(Math.random() * levels.length)];

      setLogs((prev) => [...prev.slice(-30), { timestamp, level: randomLevel, message: randomMsg }]);
    }, 4000);

    return () => clearInterval(logInterval);
  }, []);

  // Auto-scroll console
  useEffect(() => {
    logConsoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleAddRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    addSystemRole(newRoleName.trim());
    setNewRoleName("");
  };

  return (
    <div className="px-6 py-8 flex flex-col gap-8 w-full max-w-5xl mx-auto">
      {/* Title Header */}
      <div className="flex flex-col gap-1.5 border-b border-border pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Admin Config
        </h1>
        <p className="text-sm text-muted-foreground">
          Adjust global role privileges and monitor real-time cluster health logs.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {/* Rules Table (Col span 2) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-soft hover:shadow-soft-hover transition-all duration-300">
            <h3 className="text-base font-bold text-foreground mb-4">
              System Access Rules
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-foreground">
                <thead>
                  <tr className="border-b border-border text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
                    <th className="pb-3 pt-2">Role Name</th>
                    <th className="pb-3 pt-2 text-center w-[120px]">Read Sources</th>
                    <th className="pb-3 pt-2 text-center w-[120px]">Modify Connectors</th>
                    <th className="pb-3 pt-2 text-center w-[120px]">System Config</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {systemRoles.map((role) => (
                    <tr key={role.id} className="hover:bg-surface-muted/30 transition-colors">
                      <td className="py-3.5 font-semibold text-foreground">{role.name}</td>
                      
                      {/* Checkbox 1 */}
                      <td className="py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={role.readSources}
                          onChange={() => togglePermission(role.id, "readSources")}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </td>

                      {/* Checkbox 2 */}
                      <td className="py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={role.modifyConnectors}
                          onChange={() => togglePermission(role.id, "modifyConnectors")}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </td>

                      {/* Checkbox 3 */}
                      <td className="py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={role.systemConfig}
                          onChange={() => togglePermission(role.id, "systemConfig")}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick role adder */}
            <form onSubmit={handleAddRole} className="mt-6 pt-4 border-t border-border flex items-center gap-3">
              <input
                type="text"
                required
                placeholder="e.g. Data Auditor, Analyst"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                className="h-9 flex-1 px-3 rounded-lg border border-border bg-surface text-xs text-foreground focus:outline-none focus:border-primary transition-all"
              />
              <button
                type="submit"
                className="h-9 px-4 bg-primary text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer whitespace-nowrap"
              >
                Add Role
              </button>
            </form>
          </div>
        </div>

        {/* Cluster health sidebar */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-soft hover:shadow-soft-hover transition-all duration-300">
            <h3 className="text-base font-bold text-foreground mb-4">
              Diagnostic Health
            </h3>

            <div className="space-y-4">
              {/* CPU load */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-muted-foreground">Simulated CPU Load</span>
                  <span className="text-foreground">{cpu}%</span>
                </div>
                <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-500"
                    style={{ width: `${cpu}%` }}
                  />
                </div>
              </div>

              {/* Memory Allocation */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-muted-foreground">RAM Memory Swaps</span>
                  <span className="text-foreground">{memory}%</span>
                </div>
                <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${memory}%` }}
                  />
                </div>
              </div>

              {/* API Response times */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-muted-foreground">Avg API latency</span>
                  <span className="text-foreground">{latency}ms</span>
                </div>
                <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      latency > 220 ? "bg-amber-500" : "bg-blue-500"
                    }`}
                    style={{ width: `${Math.min(100, (latency / 300) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live System Diagnostics Logs console */}
      <div className="rounded-2xl border border-border bg-slate-900 p-6 shadow-2xl flex flex-col h-[280px]">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h3 className="text-xs font-bold text-slate-200 tracking-wider uppercase">
              Platform Diagnostics console
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">cluster-node-01:online</span>
        </div>

        {/* Code console view */}
        <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1.5 scrollbar-thin">
          {logs.map((log, index) => {
            const levelColor =
              log.level === "ERROR"
                ? "text-red-400"
                : log.level === "WARN"
                ? "text-amber-400"
                : log.level === "DEBUG"
                ? "text-blue-400"
                : "text-slate-400";
            return (
              <div key={index} className="flex gap-2 items-start leading-relaxed hover:bg-slate-800/40 p-0.5 rounded">
                <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                <span className={`${levelColor} font-bold shrink-0`}>[{log.level}]</span>
                <span>{log.message}</span>
              </div>
            );
          })}
          <div ref={logConsoleEndRef} />
        </div>
      </div>
    </div>
  );
}
