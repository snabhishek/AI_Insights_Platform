"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import MessageModal from "../shared/ui/MessageModal";
import ConfirmationModal from "../shared/ui/ConfirmationModal";
import CreateWorkspaceModal from "../shared/ui/CreateWorkspaceModal";
import ToastNotification, { ToastItem } from "../shared/ui/ToastNotification";

export interface ConnectionConfig {
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  password?: string;
  account?: string;    // snowflake
  url?: string;        // restapi
  method?: string;     // restapi
  headers?: string;    // restapi JSON
  fileName?: string;   // excel/csv/tsv
  fileContent?: string;
}

export interface DataSource {
  id: string;
  name: string;
  subtext: string;
  type: "postgres" | "mysql" | "sqlserver" | "snowflake" | "mongodb" | "excel" | "csv" | "tsv" | "restapi";
  status: "Connected" | "Disconnected" | "Syncing";
  health: "Healthy" | "Warning" | "Error";
  lastSyncTime: string;
  lastSyncDate: string;
  workspaceId: string;
  assets: {
    tables: number;
    views: number | null;
    pipelines: number;
  };
  connectionConfig?: ConnectionConfig;
}

export interface Project {
  id: string;
  name: string;
  role: "OWNER" | "MEMBER";
  dataSources: string[];
  initials: string;
  workspaceId: string;
  createdAt?: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
  agentState?: Record<string, unknown>;
}

export interface UserProfile {
  name: string;
  email: string;
  role: string;
  tokensLeft: string;
  daysRemaining: number;
  tasksCount: number;
}

export interface Workspace {
  id: string;
  name: string;
  isDefault?: boolean;
  createdAt?: string;
}

interface AppContextType {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;
  addWorkspace: (name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  projects: Project[];
  addProject: (name: string, role: "OWNER" | "MEMBER", dataSources: string[], useCase: string, domain?: string, subDomain?: string) => Promise<boolean>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  dataSources: DataSource[];
  addDataSource: (name: string, type: DataSource["type"], subtext: string, config: ConnectionConfig) => Promise<void>;
  deleteDataSource: (id: string) => Promise<void>;
  syncDataSource: (id: string) => Promise<void>;
  syncAllDataSources: () => Promise<void>;
  disconnectDataSource: (id: string) => Promise<void>;
  reconnectDataSource: (id: string) => Promise<void>;
  updateDataSource: (id: string, name: string, config: ConnectionConfig) => Promise<void>;
  isSyncingAll: boolean;
  userProfile: UserProfile;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  testConnection: (type: DataSource["type"], config: ConnectionConfig) => Promise<{ success: boolean; message: string; latencyMs: number }>;
  showToast: (config: { title: string; message: string; type?: "success" | "error" | "info" | "warning"; duration?: number }) => void;
  showNotification: (config: { title: string; message: string; type?: "success" | "error" | "info" | "warning"; duration?: number }) => void;
  showAlert: (config: { title: string; message: string; type: "success" | "error" | "info" | "warning"; logs?: string }) => void;
  showConfirm: (config: { title: string; message: string; confirmText?: string; cancelText?: string; onConfirm: () => void }) => void;
  openCreateWorkspace: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:5000/api";

// Helper function to fetch resources with retry logic to handle initial dev server spin-up delays
async function fetchWithRetry(url: string, options?: RequestInit, retries = 5, delay = 1000): Promise<Response> {
  try {
    const res = await fetch(url, options);
    // If we get a server-side error that might be temporary (e.g. while database is migrating/seeding)
    if (!res.ok && retries > 0 && [500, 502, 503, 504].includes(res.status)) {
      console.warn(`Fetch to ${url} failed with status ${res.status}. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 1.5);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      console.warn(`Fetch to ${url} encountered network error: ${err}. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 1.5);
    }
    throw err;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("activeWorkspaceId");
      if (saved) return saved;
    }
    return "default";
  });

  const [projects, setProjects] = useState<Project[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Toast Notification state (top-right modern shared notification)
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (config: {
      title: string;
      message: string;
      type?: "success" | "error" | "info" | "warning";
      duration?: number;
    }) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newToast: ToastItem = {
        id,
        title: config.title,
        message: config.message,
        type: config.type || "info",
        duration: config.duration || 4500,
      };
      setToasts((prev) => [...prev.slice(-4), newToast]);
    },
    []
  );

  // Message Modal state (for full diagnostic logs)
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{
    title: string;
    message: string;
    type: "success" | "error" | "info";
    logs?: string;
  }>({ title: "", message: "", type: "info" });

  // Confirmation Modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
  }>({ title: "", message: "", onConfirm: () => {} });

  // Create Workspace Modal state
  const [createWsOpen, setCreateWsOpen] = useState(false);

  const showAlert = useCallback(
    (config: {
      title: string;
      message: string;
      type?: "success" | "error" | "info" | "warning";
      logs?: string;
    }) => {
      // If diagnostic logs are provided, render full MessageModal
      if (config.logs) {
        setAlertConfig({
          title: config.title,
          message: config.message,
          type: config.type === "warning" ? "info" : (config.type || "info"),
          logs: config.logs,
        });
        setAlertOpen(true);
      } else {
        // Standard notification: display shared top-right modern toast
        showToast({
          title: config.title,
          message: config.message,
          type: config.type || "info",
        });
      }
    },
    [showToast]
  );

  const showConfirm = (config: typeof confirmConfig) => {
    setConfirmConfig(config);
    setConfirmOpen(true);
  };

  const [userProfile, setUserProfile] = useState<UserProfile>({
    name: "SanthoshKumaran",
    email: "santhosh@cei.com",
    role: "Standard",
    tokensLeft: "100.0M",
    daysRemaining: 15,
    tasksCount: 100,
  });

  // ─── Fetch workspaces on mount ──────────────────────────────────────────────
  useEffect(() => {
    async function fetchWorkspaces() {
      try {
        const res = await fetchWithRetry(`${BACKEND_URL}/workspaces`);
        if (res.ok) {
          const data: Workspace[] = await res.json();
          setWorkspaces(data);

          if (data.length > 0) {
            const savedWsId = typeof window !== "undefined" ? localStorage.getItem("activeWorkspaceId") : null;
            const hasSaved = savedWsId && data.some((w) => w.id === savedWsId);

            if (hasSaved) {
              // Land on current workspace user was in (default or custom)
              setActiveWorkspaceIdState(savedWsId!);
            } else {
              // First load rules:
              // If there are no workspaces other than Default workspace then load default workspace
              // else load the first available workspace in the list.
              const defaultWs = data.find((w) => w.isDefault || w.id === "default");
              const nonDefaultWorkspaces = data.filter((w) => !w.isDefault && w.id !== "default");

              let targetId: string;
              if (nonDefaultWorkspaces.length === 0) {
                targetId = defaultWs ? defaultWs.id : data[0].id;
              } else {
                targetId = data[0].id;
              }

              setActiveWorkspaceIdState(targetId);
              if (typeof window !== "undefined") {
                localStorage.setItem("activeWorkspaceId", targetId);
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load workspaces:", err);
      }
    }
    fetchWorkspaces();
  }, []);

  // ─── Fetch projects + data sources when active workspace changes ────────────
  const fetchWorkspaceData = useCallback(async (wsId: string) => {
    try {
      const [projRes, srcRes] = await Promise.all([
        fetchWithRetry(`${BACKEND_URL}/workspaces/${wsId}/projects`),
        fetchWithRetry(`${BACKEND_URL}/connectors?workspaceId=${wsId}`),
      ]);
      if (projRes.ok) setProjects(await projRes.json());
      if (srcRes.ok) setDataSources(await srcRes.json());
    } catch (err) {
      console.error("Failed to load workspace data:", err);
    }
  }, []);

  useEffect(() => {
    if (activeWorkspaceId) fetchWorkspaceData(activeWorkspaceId);
  }, [activeWorkspaceId, fetchWorkspaceData]);

  // ─── Workspace switching ────────────────────────────────────────────────────
  const setActiveWorkspaceId = (id: string) => {
    setActiveWorkspaceIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("activeWorkspaceId", id);
    }
  };

  // ─── Create workspace ───────────────────────────────────────────────────────
  const addWorkspace = async (name: string) => {
    const res = await fetch(`${BACKEND_URL}/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to create workspace");
    setWorkspaces((prev) => [...prev, data]);
    setActiveWorkspaceId(data.id);
  };

  // ─── Delete workspace ───────────────────────────────────────────────────────
  const deleteWorkspace = async (id: string) => {
    const res = await fetch(`${BACKEND_URL}/workspaces/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      showAlert({ title: "Delete Failed", message: data.message || "Could not delete workspace.", type: "error" });
      return;
    }
    setWorkspaces((prev) => {
      const remaining = prev.filter((w) => w.id !== id);
      if (activeWorkspaceId === id && remaining.length > 0) {
        const nonDefault = remaining.filter((w) => !w.isDefault && w.id !== "default");
        const defaultWs = remaining.find((w) => w.isDefault || w.id === "default");
        const nextId = nonDefault.length === 0 ? (defaultWs ? defaultWs.id : remaining[0].id) : remaining[0].id;
        setActiveWorkspaceId(nextId);
      }
      return remaining;
    });
  };

  // ─── Projects ───────────────────────────────────────────────────────────────
  const addProject = async (name: string, role: "OWNER" | "MEMBER", dsSources: string[], useCase: string, domain?: string, subDomain?: string): Promise<boolean> => {
    const initials = userProfile.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "US";

    const wsId = activeWorkspaceId || "default";
    try {
      const res = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, dataSources: dsSources, initials, useCase, domain, subDomain }),
      });
      if (res.ok) {
        const newProject = await res.json();
        setProjects((prev) => [newProject, ...prev]);
        return true;
      } else {
        const err = await res.json();
        showAlert({ title: "Project Creation Error", message: err.message || "A project with this title already exists.", type: "error" });
        return false;
      }
    } catch (err: any) {
      showAlert({ title: "Project Creation Failed", message: err.message || "Failed to create project", type: "error" });
      return false;
    }
  };

  const updateProject = async (id: string, updates: Partial<Project>) => {
    const wsId = activeWorkspaceId || "default";
    try {
      const res = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const updatedProject = await res.json();
        setProjects((prev) => prev.map((p) => (p.id === id ? updatedProject : p)));
      } else {
        const text = await res.text();
        if (!res.ok) {
          console.warn(`Update project failed (${res.status}):`, text.slice(0, 100));
        }
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
      }
    } catch (err: any) {
      console.warn("Update project backend request failed, syncing locally:", err?.message || err);
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    }
  };

  const deleteProject = async (id: string) => {
    const wsId = activeWorkspaceId || "default";
    try {
      const res = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${id}`, { method: "DELETE" });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } else {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete project");
      }
    } catch (err: any) {
      showAlert({ title: "Delete Failed", message: err.message, type: "error" });
    }
  };

  // ─── Connectors ─────────────────────────────────────────────────────────────
  const testConnection = async (type: DataSource["type"], config: ConnectionConfig) => {
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, config }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message || "Failed to contact validation server", latencyMs: 0 };
    }
  };

  const addDataSource = async (name: string, type: DataSource["type"], subtext: string, config: ConnectionConfig) => {
    const wsId = activeWorkspaceId || "default";
    try {
      const res = await fetch(`${BACKEND_URL}/connectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, subtext, config, workspaceId: wsId }),
      });
      if (res.ok) {
        const newSource = await res.json();
        setDataSources((prev) => [newSource, ...prev]);
        showToast({
          title: "Successfully Connected",
          message: `Data source "${name}" connected successfully.`,
          type: "success",
        });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to save connector");
      }
    } catch (err: any) {
      console.error(err);
      showToast({
        title: "Connection Failed",
        message: err.message || "Could not register connector config.",
        type: "error",
      });
    }
  };

  const deleteDataSource = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDataSources((prev) => prev.filter((ds) => ds.id !== id));
        showAlert({ title: "Connection Deleted", message: "Data source has been permanently deleted from storage.", type: "success" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to delete connector");
      }
    } catch (err: any) {
      console.error("Failed to delete source:", err);
      showAlert({ title: "Deletion Failed", message: err.message || "Could not remove database record.", type: "error" });
    }
  };

  const disconnectDataSource = async (id: string) => {
    setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Disconnected" } : ds)));
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}/disconnect`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) => prev.map((ds) => (ds.id === id ? updated : ds)));
        showAlert({ title: "Connection Disconnected", message: "Data source has been disconnected. Live catalog monitoring paused.", type: "info" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to disconnect");
      }
    } catch (err: any) {
      console.error("Failed to disconnect source:", err);
      setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds)));
      showAlert({ title: "Disconnection Failed", message: err.message || "Could not change status.", type: "error" });
    }
  };

  const reconnectDataSource = async (id: string) => {
    setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds)));
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}/connect`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) => prev.map((ds) => (ds.id === id ? updated : ds)));
        showAlert({ title: "Connection Restored", message: "Data source has been successfully reconnected.", type: "success" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to connect");
      }
    } catch (err: any) {
      console.error("Failed to connect source:", err);
      setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Disconnected" } : ds)));
      showAlert({ title: "Reconnection Failed", message: err.message || "Could not change status.", type: "error" });
    }
  };

  const updateDataSource = async (id: string, name: string, config: ConnectionConfig) => {
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) => prev.map((ds) => (ds.id === id ? updated : ds)));
        showAlert({ title: "Connection Updated", message: `Data source configuration for "${name}" updated successfully.`, type: "success" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to update connector");
      }
    } catch (err: any) {
      console.error("Failed to update source:", err);
      showAlert({ title: "Update Failed", message: err.message || "Could not save connection parameters.", type: "error" });
    }
  };

  const syncDataSource = async (id: string) => {
    setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Syncing" } : ds)));
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}/sync`, { method: "POST" });
      if (res.ok) {
        setTimeout(async () => {
          try {
            const statusRes = await fetch(`${BACKEND_URL}/connectors/${id}`);
            if (statusRes.ok) {
              const updated = await statusRes.json();
              setDataSources((prev) => prev.map((ds) => (ds.id === id ? updated : ds)));
            }
          } catch (err) { console.error(err); }
        }, 1600);
      } else {
        setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds)));
      }
    } catch (err) {
      console.error(err);
      setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds)));
    }
  };

  const syncAllDataSources = async () => {
    setIsSyncingAll(true);
    setDataSources((prev) => prev.map((ds) => ({ ...ds, status: "Syncing" })));
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/sync-all`, { method: "POST" });
      if (res.ok) {
        setTimeout(async () => {
          try {
            const fetchRes = await fetch(`${BACKEND_URL}/connectors?workspaceId=${activeWorkspaceId}`);
            if (fetchRes.ok) setDataSources(await fetchRes.json());
          } catch (err) { console.error(err); }
          finally { setIsSyncingAll(false); }
        }, 2200);
      } else {
        setIsSyncingAll(false);
      }
    } catch (err) {
      console.error(err);
      setIsSyncingAll(false);
    }
  };

  const updateUserProfile = (profile: Partial<UserProfile>) => {
    setUserProfile((prev) => ({ ...prev, ...profile }));
  };

  return (
    <AppContext.Provider
      value={{
        workspaces,
        activeWorkspaceId,
        setActiveWorkspaceId,
        addWorkspace,
        deleteWorkspace,
        projects,
        addProject,
        updateProject,
        deleteProject,
        dataSources,
        addDataSource,
        deleteDataSource,
        syncDataSource,
        syncAllDataSources,
        disconnectDataSource,
        reconnectDataSource,
        updateDataSource,
        isSyncingAll,
        userProfile,
        updateUserProfile,
        testConnection,
        showToast,
        showNotification: showToast,
        showAlert,
        showConfirm,
        openCreateWorkspace: () => setCreateWsOpen(true),
      }}
    >
      {children}

      <ToastNotification toasts={toasts} onDismiss={dismissToast} />

      <MessageModal
        isOpen={alertOpen}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        logs={alertConfig.logs}
        onClose={() => setAlertOpen(false)}
      />

      <ConfirmationModal
        isOpen={confirmOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmText={confirmConfig.confirmText}
        cancelText={confirmConfig.cancelText}
        onConfirm={() => {
          confirmConfig.onConfirm();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      <CreateWorkspaceModal
        isOpen={createWsOpen}
        onClose={() => setCreateWsOpen(false)}
        onCreate={addWorkspace}
      />
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
