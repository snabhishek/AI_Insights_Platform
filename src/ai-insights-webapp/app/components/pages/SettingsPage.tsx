"use client";

import React, { useState } from "react";
import { useApp } from "../providers/AppContext";

type SettingsSection = "profile" | "workspace" | "billing" | "security";

export default function SettingsPage() {
  const { userProfile, updateUserProfile, workspaces, activeWorkspaceId, setActiveWorkspaceId } = useApp();
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");

  // Form States
  const [name, setName] = useState(userProfile.name);
  const [email, setEmail] = useState(userProfile.email);
  const [role, setRole] = useState(userProfile.role);
  const [password, setPassword] = useState("");
  const [enable2FA, setEnable2FA] = useState(false);

  // Toast Feedback State
  const [showToast, setShowToast] = useState(false);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUserProfile({ name, email, role });
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleSaveSecurity = (e: React.FormEvent) => {
    e.preventDefault();
    setShowToast(true);
    setPassword("");
    setTimeout(() => setShowToast(false), 3000);
  };

  return (
    <div className="px-6 py-8 flex flex-col gap-6 w-full max-w-5xl mx-auto">
      {/* Title Header */}
      <div className="flex flex-col gap-1.5 border-b border-border pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your account profile, workspaces, security protocols, and tokens.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-stretch">
        {/* Sidebar Tabs */}
        <div className="md:col-span-1 flex flex-row md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {[
            { id: "profile", label: "Profile Info", icon: "👤" },
            { id: "workspace", label: "Workspace", icon: "📁" },
            { id: "billing", label: "Billing & Usage", icon: "💳" },
            { id: "security", label: "Security & Keys", icon: "🔒" },
          ].map((tab) => {
            const isActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as SettingsSection)}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-all text-left w-full ${
                  isActive
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Settings Content Panel */}
        <div className="md:col-span-3 rounded-2xl border border-border bg-surface p-6 shadow-soft hover:shadow-soft-hover transition-all duration-300 min-h-[360px]">
          {/* Profile settings tab */}
          {activeSection === "profile" && (
            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-foreground mb-1">
                  Profile Settings
                </h3>
                <p className="text-xs text-muted-foreground">
                  Update your identity details. These will reflect on your profile card.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Plan Type / System Role
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  >
                    <option value="Administrator">Administrator</option>
                    <option value="Standard">Standard User</option>
                    <option value="Guest">Read-Only Guest</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-border flex justify-end">
                <button
                  type="submit"
                  className="h-9 px-5 bg-primary text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          )}

          {/* Workspace settings tab */}
          {activeSection === "workspace" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-foreground mb-1">
                  Workspace Configuration
                </h3>
                <p className="text-xs text-muted-foreground">
                  Switch or manage the currently active team workspace.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Active Workspace
                  </label>
                  <select
                    value={activeWorkspaceId}
                    onChange={(e) => setActiveWorkspaceId(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary transition-all"
                  >
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Billing Cycle Remaining
                  </label>
                  <div className="text-sm font-semibold text-foreground mt-1 bg-surface-muted p-3.5 rounded-lg border border-border/40">
                    🕒 {userProfile.daysRemaining} days remaining in current evaluation cycle
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Billing settings tab */}
          {activeSection === "billing" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-foreground mb-1">
                  Tokens & Billing
                </h3>
                <p className="text-xs text-muted-foreground">
                  Monitor your LLM token consumption limits.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-border/60 bg-surface-muted p-4">
                  <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Total Quota Allocated
                  </span>
                  <span className="block text-2xl font-bold text-foreground mt-1">
                    100.0M Tokens
                  </span>
                </div>
                <div className="rounded-xl border border-border/60 bg-surface-muted p-4">
                  <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Remaining Quota
                  </span>
                  <span className="block text-2xl font-bold text-green-500 mt-1">
                    {userProfile.tokensLeft} Tokens
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-muted-foreground uppercase">
                  Workspace Consumption History
                </label>
                <div className="text-xs text-muted-foreground border border-border rounded-xl divide-y divide-border overflow-hidden">
                  <div className="flex justify-between p-3 bg-surface-muted/30">
                    <span>July 06, 2026</span>
                    <span className="font-semibold text-foreground">14,203 tokens</span>
                  </div>
                  <div className="flex justify-between p-3 bg-surface-muted/30">
                    <span>July 05, 2026</span>
                    <span className="font-semibold text-foreground">125,830 tokens</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Security Settings Tab */}
          {activeSection === "security" && (
            <form onSubmit={handleSaveSecurity} className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-foreground mb-1">
                  Security Options
                </h3>
                <p className="text-xs text-muted-foreground">
                  Update account credentials and toggle session verification constraints.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 border border-border/80 rounded-xl bg-surface-muted/40">
                  <div>
                    <span className="block text-xs font-bold text-foreground">
                      Two-Factor Authentication
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      Secure account logs with biometric codes.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnable2FA(!enable2FA)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      enable2FA ? "bg-primary" : "bg-gray-200 dark:bg-gray-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        enable2FA ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    New Security Password
                  </label>
                  <input
                    type="password"
                    placeholder="Enter new account password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border flex justify-end">
                <button
                  type="submit"
                  disabled={!password}
                  className="h-9 px-5 bg-primary text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:scale-100"
                >
                  Change Password
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Success Notification Toast Overlay */}
      {showToast && (
        <div className="fixed bottom-5 right-5 z-[200] rounded-xl border border-green-500/20 bg-green-500 px-4 py-3 text-sm font-semibold text-white shadow-2xl animate-fade-in flex items-center gap-2">
          <span>✔</span>
          <span>Configuration saved successfully!</span>
        </div>
      )}
    </div>
  );
}
