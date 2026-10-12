"use client";

import Image from "next/image";
import { LogOut } from "lucide-react";
import Button from "../ui/Button";
import ThemeToggle from "../ui/ThemeToggle";
import UserProfile from "../ui/UserProfile";
import WorkspaceSwitcher from "../ui/WorkspaceSwitcher";
import { useApp } from "../../providers/AppContext";

export default function Header() {
  const {
    userProfile,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    openCreateWorkspace,
    deleteWorkspace,
    showConfirm,
  } = useApp();

  const handleLogout = () => {};

  const handleDeleteWorkspace = (id: string) => {
    const workspace = workspaces.find((w) => w.id === id);
    if (!workspace) return;
    showConfirm({
      title: "Delete Workspace",
      message: (
        <>
          <span className="font-semibold">Are you sure you want to delete &quot;{workspace.name}&quot;?</span><br/>
          {" "}All projects inside will be permanently deleted. This action cannot be undone.
        </>
      ),
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: () => deleteWorkspace(id),
    });
  };

  const metaString = `${userProfile.role} • ${userProfile.daysRemaining} days • ${userProfile.tasksCount} tasks • ${userProfile.tokensLeft} tokens left`;

  return (
    <header className="flex h-[68px] w-full items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <Image
            src="/images/compass-logo.png"
            alt="Compass"
            width={32}
            height={32}
            priority
            className="h-7 w-auto object-contain"
          />
          <span className="text-lg font-bold tracking-tight text-primary dark:text-blue-400">
            Compass
          </span>
        </div>

        <span className="h-7 w-px bg-border" aria-hidden="true" />

        <WorkspaceSwitcher
          workspaces={workspaces}
          selectedId={activeWorkspaceId}
          onSelect={setActiveWorkspaceId}
          onCreate={openCreateWorkspace}
          onDelete={handleDeleteWorkspace}
        />
      </div>

      <div className="flex items-center gap-5">
        <UserProfile
          name={userProfile.name}
          meta={metaString}
        />
        <ThemeToggle />
        <Button icon={<LogOut className="w-4 h-4" />} onClick={handleLogout}>
          Logout
        </Button>
      </div>
    </header>
  );
}
