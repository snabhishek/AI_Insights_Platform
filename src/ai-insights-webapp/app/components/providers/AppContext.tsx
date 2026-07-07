"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import MessageModal from "../shared/ui/MessageModal";
import ConfirmationModal from "../shared/ui/ConfirmationModal";

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
  dataSources: string[]; // types of data sources
  initials: string;
  workspaceId: string;
}

export interface UserProfile {
  name: string;
  email: string;
  role: string;
  tokensLeft: string;
  daysRemaining: number;
  tasksCount: number;
}

export interface SystemRole {
  id: string;
  name: string;
  readSources: boolean;
  modifyConnectors: boolean;
  systemConfig: boolean;
}

export interface Workspace {
  id: string;
  name: string;
}

interface AppContextType {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;
  addWorkspace: (name: string) => void;
  projects: Project[];
  addProject: (name: string, role: "OWNER" | "MEMBER", dataSources: string[]) => void;
  deleteProject: (id: string) => void;
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
  systemRoles: SystemRole[];
  togglePermission: (roleId: string, permissionKey: "readSources" | "modifyConnectors" | "systemConfig") => void;
  addSystemRole: (name: string) => void;
  testConnection: (type: DataSource["type"], config: ConnectionConfig) => Promise<{ success: boolean; message: string; latencyMs: number }>;
  showAlert: (config: { title: string; message: string; type: "success" | "error" | "info"; logs?: string }) => void;
  showConfirm: (config: { title: string; message: string; confirmText?: string; cancelText?: string; onConfirm: () => void }) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const INITIAL_PROJECTS: Project[] = [
  {
    id: "testing-project",
    name: "Testing Project",
    role: "MEMBER",
    dataSources: ["postgres", "mysql", "excel"],
    initials: "KA",
    workspaceId: "personal",
  },
  {
    id: "sample-project-2",
    name: "Sample Project 2",
    role: "OWNER",
    dataSources: ["snowflake", "mongodb"],
    initials: "KA",
    workspaceId: "personal",
  },
  {
    id: "sample-project",
    name: "Sample Project",
    role: "OWNER",
    dataSources: ["sqlserver", "csv"],
    initials: "KA",
    workspaceId: "personal",
  },
];

const INITIAL_ROLES: SystemRole[] = [
  {
    id: "admin",
    name: "Administrator",
    readSources: true,
    modifyConnectors: true,
    systemConfig: true,
  },
  {
    id: "user",
    name: "Standard User",
    readSources: true,
    modifyConnectors: true,
    systemConfig: false,
  },
];

const BACKEND_URL = "http://127.0.0.1:4000/api/connectors";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([
    { id: "personal", name: "Personal Workspace" },
    { id: "team", name: "Team Workspace" },
  ]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("personal");

  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [systemRoles, setSystemRoles] = useState<SystemRole[]>(INITIAL_ROLES);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Message Modal state
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

  const showAlert = (config: typeof alertConfig) => {
    setAlertConfig(config);
    setAlertOpen(true);
  };

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

  // Fetch all data sources from backend on mount
  useEffect(() => {
    async function fetchSources() {
      try {
        const res = await fetch(BACKEND_URL);
        if (res.ok) {
          const data = await res.json();
          setDataSources(data);
        }
      } catch (err) {
        console.error("Failed to load connected sources from backend:", err);
      }
    }
    fetchSources();
  }, []);

  const addWorkspace = (name: string) => {
    const id = name.toLowerCase().replace(/\s+/g, "-");
    if (workspaces.some((w) => w.id === id)) return;
    setWorkspaces((prev) => [...prev, { id, name }]);
    setActiveWorkspaceId(id);
  };

  const addProject = (name: string, role: "OWNER" | "MEMBER", dataSources: string[]) => {
    const initials = userProfile.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    const newProject: Project = {
      id: name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now(),
      name,
      role,
      dataSources,
      initials: initials || "US",
      workspaceId: activeWorkspaceId,
    };
    setProjects((prev) => [newProject, ...prev]);
  };

  const deleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  // Real API calls for connectors
  const testConnection = async (type: DataSource["type"], config: ConnectionConfig) => {
    try {
      const res = await fetch(`${BACKEND_URL}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, config }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message || "Failed to contact validation server", latencyMs: 0 };
    }
  };

  const addDataSource = async (
    name: string,
    type: DataSource["type"],
    subtext: string,
    config: ConnectionConfig
  ) => {
    try {
      const res = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, subtext, config }),
      });
      if (res.ok) {
        const newSource = await res.json();
        setDataSources((prev) => [newSource, ...prev]);
        showAlert({
          title: "Connection Succeeded",
          message: `Data source "${name}" connected successfully. Discovered assets have been cataloged.`,
          type: "success",
        });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to save connector");
      }
    } catch (err: any) {
      console.error(err);
      showAlert({
        title: "Connection Failed",
        message: err.message || "Could not register connector config.",
        type: "error",
      });
    }
  };

  const deleteDataSource = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDataSources((prev) => prev.filter((ds) => ds.id !== id));
        showAlert({
          title: "Connection Deleted",
          message: "Data source has been permanently deleted from storage.",
          type: "success",
        });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to delete connector");
      }
    } catch (err: any) {
      console.error("Failed to delete source:", err);
      showAlert({
        title: "Deletion Failed",
        message: err.message || "Could not remove database record.",
        type: "error",
      });
    }
  };

  const disconnectDataSource = async (id: string) => {
    // Optimistic status update
    setDataSources((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, status: "Disconnected" } : ds))
    );

    try {
      const res = await fetch(`${BACKEND_URL}/${id}/disconnect`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) =>
          prev.map((ds) => (ds.id === id ? updated : ds))
        );
        showAlert({
          title: "Connection Disconnected",
          message: "Data source has been disconnected. Live catalog monitoring paused.",
          type: "info",
        });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to disconnect");
      }
    } catch (err: any) {
      console.error("Failed to disconnect source:", err);
      setDataSources((prev) =>
        prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds))
      );
      showAlert({
        title: "Disconnection Failed",
        message: err.message || "Could not change status.",
        type: "error",
      });
    }
  };

  const reconnectDataSource = async (id: string) => {
    // Optimistic status update
    setDataSources((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds))
    );

    try {
      const res = await fetch(`${BACKEND_URL}/${id}/connect`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) =>
          prev.map((ds) => (ds.id === id ? updated : ds))
        );
        showAlert({
          title: "Connection Restored",
          message: "Data source has been successfully reconnected.",
          type: "success",
        });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to connect");
      }
    } catch (err: any) {
      console.error("Failed to connect source:", err);
      setDataSources((prev) =>
        prev.map((ds) => (ds.id === id ? { ...ds, status: "Disconnected" } : ds))
      );
      showAlert({
        title: "Reconnection Failed",
        message: err.message || "Could not change status.",
        type: "error",
      });
    }
  };

  const updateDataSource = async (id: string, name: string, config: ConnectionConfig) => {
    try {
      const res = await fetch(`${BACKEND_URL}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDataSources((prev) =>
          prev.map((ds) => (ds.id === id ? updated : ds))
        );
        showAlert({
          title: "Connection Updated",
          message: `Data source configuration for "${name}" updated successfully.`,
          type: "success",
        });
      } else {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to update connector");
      }
    } catch (err: any) {
      console.error("Failed to update source:", err);
      showAlert({
        title: "Update Failed",
        message: err.message || "Could not save connection parameters.",
        type: "error",
      });
    }
  };

  const syncDataSource = async (id: string) => {
    // Optimistic status update
    setDataSources((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, status: "Syncing" } : ds))
    );

    try {
      const res = await fetch(`${BACKEND_URL}/${id}/sync`, { method: "POST" });
      if (res.ok) {
        // Poll for completion or update locally after brief timeout
        setTimeout(async () => {
          try {
            const statusRes = await fetch(`${BACKEND_URL}/${id}`);
            if (statusRes.ok) {
              const updated = await statusRes.json();
              setDataSources((prev) =>
                prev.map((ds) => (ds.id === id ? updated : ds))
              );
            }
          } catch (err) {
            console.error(err);
          }
        }, 1600);
      } else {
        // Reset status if API fails
        setDataSources((prev) =>
          prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds))
        );
      }
    } catch (err) {
      console.error(err);
      setDataSources((prev) =>
        prev.map((ds) => (ds.id === id ? { ...ds, status: "Connected" } : ds))
      );
    }
  };

  const syncAllDataSources = async () => {
    setIsSyncingAll(true);
    setDataSources((prev) =>
      prev.map((ds) => ({ ...ds, status: "Syncing" }))
    );

    try {
      const res = await fetch(`${BACKEND_URL}/sync-all`, { method: "POST" });
      if (res.ok) {
        setTimeout(async () => {
          try {
            const fetchRes = await fetch(BACKEND_URL);
            if (fetchRes.ok) {
              const data = await fetchRes.json();
              setDataSources(data);
            }
          } catch (err) {
            console.error(err);
          } finally {
            setIsSyncingAll(false);
          }
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

  const togglePermission = (
    roleId: string,
    permissionKey: "readSources" | "modifyConnectors" | "systemConfig"
  ) => {
    setSystemRoles((prev) =>
      prev.map((role) => {
        if (role.id !== roleId) return role;
        return {
          ...role,
          [permissionKey]: !role[permissionKey],
        };
      })
    );
  };

  const addSystemRole = (name: string) => {
    const id = name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    const newRole: SystemRole = {
      id,
      name,
      readSources: true,
      modifyConnectors: false,
      systemConfig: false,
    };
    setSystemRoles((prev) => [...prev, newRole]);
  };

  return (
    <AppContext.Provider
      value={{
        workspaces,
        activeWorkspaceId,
        setActiveWorkspaceId,
        addWorkspace,
        projects,
        addProject,
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
        systemRoles,
        togglePermission,
        addSystemRole,
        testConnection,
        showAlert,
        showConfirm,
      }}
    >
      {children}

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
