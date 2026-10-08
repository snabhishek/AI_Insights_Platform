"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
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
  account?: string;
  url?: string;
  method?: string;
  headers?: string;
  fileName?: string;
  fileContent?: string;
}

export interface Connector {
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

export type DataSource = Connector;

export function getDataSourceCategory(ds: DataSource | null | undefined): string {
  if (!ds) return "";

  const type = ds.type ? ds.type.toLowerCase() : "";
  if (type === "postgres" || type === "mysql" || type === "sqlserver" || type === "mongodb") {
    return "Database";
  }
  if (type === "snowflake") {
    return "Data Warehouse";
  }
  if (type === "restapi") {
    return "API";
  }
  if (type === "excel" || type === "csv" || type === "tsv") {
    const sub = ds.subtext ? ds.subtext.toLowerCase() : "";
    const name = ds.name ? ds.name.toLowerCase() : "";
    if (sub.includes("cloud") || sub.includes("storage") || name.includes("cloud storage") || name.includes("s3")) {
      return "Cloud Storage";
    }
    return "File";
  }

  const sub = ds.subtext ? ds.subtext.toLowerCase() : "";
  const name = ds.name ? ds.name.toLowerCase() : "";
  if (sub.includes("warehouse") || name.includes("warehouse")) return "Data Warehouse";
  if (sub.includes("database") || name.includes("database")) return "Database";
  if (sub.includes("api") || name.includes("api")) return "API";
  if (sub.includes("cloud") || sub.includes("storage") || name.includes("cloud") || name.includes("storage")) return "Cloud Storage";
  if (sub.includes("file") || sub.endsWith(".csv") || sub.endsWith(".xlsx") || sub.endsWith(".xls") || sub.endsWith(".tsv")) return "File";

  return ds.type || ds.subtext || "";
}

export interface Project {
  id: string;
  projectName?: string;
  name: string;
  role: "OWNER" | "MEMBER";
  dataSources: string[];
  initials: string;
  workspaceId: string;
  createdAt?: string;
  useCase?: string;
  domain?: string;
  subDomain?: string;
  status?: string;
  splitDate?: string;
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
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  refreshProjects: () => Promise<void>;
  addProject: (projectName: string, name: string, role: "OWNER" | "MEMBER", dataSources: string[], useCase: string, domain?: string, subDomain?: string, splitDate?: string) => Promise<Project | null>;
  updateProject: (id: string, updates: Partial<Project> & { replaceAgentState?: boolean }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  connectors: Connector[];
  addConnector: (name: string, type: Connector["type"], subtext: string, config: ConnectionConfig) => Promise<void>;
  deleteConnector: (id: string) => Promise<void>;
  syncConnector: (id: string) => Promise<void>;
  syncAllConnectors: () => Promise<void>;
  disconnectConnector: (id: string) => Promise<void>;
  reconnectConnector: (id: string) => Promise<void>;
  updateConnector: (id: string, name: string, config: ConnectionConfig) => Promise<void>;
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
  showToast: (config: { title?: string; message?: string; type?: "success" | "error" | "info" | "warning"; duration?: number }) => void;
  showNotification: (config: { title?: string; message?: string; type?: "success" | "error" | "info" | "warning"; duration?: number }) => void;
  showAlert: (config: { title?: string; message?: string; type?: "success" | "error" | "info" | "warning"; logs?: string; isModal?: boolean }) => void;
  showConfirm: (config: { title: string; message: React.ReactNode; confirmText?: string; cancelText?: string; onConfirm: () => void }) => void;
  openCreateWorkspace: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL!;

async function fetchWithRetry(url: string, options?: RequestInit, retries = 5, delay = 1000): Promise<Response> {
  try {
    const res = await fetch(url, options);

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

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastToastRef = useRef<{ title: string; time: number } | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (config: {
      title?: string;
      message?: string;
      type?: "success" | "error" | "info" | "warning";
      duration?: number;
    }) => {
      const messageText = config.title || config.message || "";
      if (!messageText) return;
      const now = Date.now();
      if (
        lastToastRef.current &&
        lastToastRef.current.title === messageText &&
        now - lastToastRef.current.time < 5000
      ) {
        return;
      }
      lastToastRef.current = { title: messageText, time: now };

      setToasts((prev) => {
        if (prev.some((t) => t.title === messageText)) {
          return prev;
        }
        const id = `${now}-${Math.random().toString(36).substring(2, 7)}`;
        const newToast: ToastItem = {
          id,
          title: messageText,
          message: "",
          type: config.type || "info",
          duration: config.duration || 4500,
        };
        return [...prev.slice(-3), newToast];
      });
    },
    []
  );

  const [alertOpen, setAlertOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{
    title: string;
    message: string;
    type: "success" | "error" | "info";
    logs?: string;
  }>({ title: "", message: "", type: "info" });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
  }>({ title: "", message: "", onConfirm: () => {} });

  const [createWsOpen, setCreateWsOpen] = useState(false);

  const showAlert = useCallback(
    (config: {
      title?: string;
      message?: string;
      type?: "success" | "error" | "info" | "warning";
      logs?: string;
      isModal?: boolean;
    }) => {

      if (config.logs || config.isModal) {
        setAlertConfig({
          title: config.title || "Notice",
          message: config.message || config.title || "",
          type: config.type === "warning" ? "info" : (config.type || "info"),
          logs: config.logs,
        });
        setAlertOpen(true);
      } else {

        const messageText = config.title || config.message || "";
        showToast({
          title: messageText,
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

              setActiveWorkspaceIdState(savedWsId!);
            } else {

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

  const refreshProjects = useCallback(async () => {
    const wsId = activeWorkspaceId || "default";
    try {
      const res = await fetchWithRetry(`${BACKEND_URL}/workspaces/${wsId}/projects`);
      if (res.ok) {
        const fresh: Project[] = await res.json();
        setProjects(fresh);
      }
    } catch (err) {
      console.warn("Failed to refresh projects:", err);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspaceId) fetchWorkspaceData(activeWorkspaceId);
  }, [activeWorkspaceId, fetchWorkspaceData]);

  const setActiveWorkspaceId = (id: string) => {
    setActiveWorkspaceIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("activeWorkspaceId", id);
    }
  };

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

  const renameWorkspace = async (id: string, name: string) => {
    const res = await fetch(`${BACKEND_URL}/workspaces/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to rename workspace");
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, name: data.name || name } : w))
    );
  };

  const deleteWorkspace = async (id: string) => {
    const res = await fetch(`${BACKEND_URL}/workspaces/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      showAlert({ title: data.message || "Could not delete workspace", type: "error" });
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

  const addProject = async (projectName: string, name: string, role: "OWNER" | "MEMBER", dsSources: string[], useCase: string, domain?: string, subDomain?: string, splitDate?: string): Promise<Project | null> => {
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
        body: JSON.stringify({ projectName, name, role, dataSources: dsSources, initials, useCase, domain, subDomain, splitDate }),
      });
      if (res.ok) {
        const newProject = await res.json();
        setProjects((prev) => [newProject, ...prev]);
        return newProject;
      } else {
        const err = await res.json();
        showAlert({ title: err.message || "A project with this name already exists", type: "error" });
        return null;
      }
    } catch (err: any) {
      showAlert({ title: err.message || "Failed to create project", type: "error" });
      return null;
    }
  };

  const updateProject = async (id: string, updates: Partial<Project> & { replaceAgentState?: boolean }) => {
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
        showAlert({ title: "Project Deleted", type: "success" });
      } else {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete project");
      }
    } catch (err: any) {
      showAlert({ title: err.message || "Delete Failed", type: "error" });
    }
  };

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
          title: "Connection Added",
          type: "success",
        });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to save connector");
      }
    } catch (err: any) {
      console.error(err);
      showToast({
        title: err.message || "Connection Failed",
        type: "error",
      });
    }
  };

  const deleteDataSource = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDataSources((prev) => prev.filter((ds) => ds.id !== id));
        showAlert({ title: "Connection Deleted", type: "success" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to delete connector");
      }
    } catch (err: any) {
      console.error("Failed to delete source:", err);
      showAlert({ title: err.message || "Deletion Failed", type: "error" });
    }
  };

  const disconnectDataSource = async (id: string) => {
    setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Disconnected" } : ds)));
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}/disconnect`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) => prev.map((ds) => (ds.id === id ? updated : ds)));
        showAlert({ title: "Connection Disconnected", type: "info" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to disconnect");
      }
    } catch (err: any) {
      console.error("Failed to disconnect source:", err);
      setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds)));
      showAlert({ title: err.message || "Disconnection Failed", type: "error" });
    }
  };

  const reconnectDataSource = async (id: string) => {
    setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds)));
    try {
      const res = await fetch(`${BACKEND_URL}/connectors/${id}/connect`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) => prev.map((ds) => (ds.id === id ? updated : ds)));
        showAlert({ title: "Connection Restored", type: "success" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to connect");
      }
    } catch (err: any) {
      console.error("Failed to connect source:", err);
      setDataSources((prev) => prev.map((ds) => (ds.id === id ? { ...ds, status: "Disconnected" } : ds)));
      showAlert({ title: err.message || "Reconnection Failed", type: "error" });
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
        showAlert({ title: "Connection Updated", type: "success" });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to update connector");
      }
    } catch (err: any) {
      console.error("Failed to update source:", err);
      showAlert({ title: err.message || "Update Failed", type: "error" });
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
        renameWorkspace,
        deleteWorkspace,
        projects,
        setProjects,
        refreshProjects,
        addProject,
        updateProject,
        deleteProject,
        connectors: dataSources,
        addConnector: addDataSource,
        deleteConnector: deleteDataSource,
        syncConnector: syncDataSource,
        syncAllConnectors: syncAllDataSources,
        disconnectConnector: disconnectDataSource,
        reconnectConnector: reconnectDataSource,
        updateConnector: updateDataSource,
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
