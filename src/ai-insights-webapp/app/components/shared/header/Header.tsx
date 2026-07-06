"use client";

import Image from "next/image";
import Button from "../ui/Button";
import ThemeToggle from "../ui/ThemeToggle";
import UserProfile from "../ui/UserProfile";
import WorkspaceSwitcher from "../ui/WorkspaceSwitcher";
import { useApp } from "../../providers/AppContext";

const LogoutIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export default function Header() {
  const {
    userProfile,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
  } = useApp();

  const handleLogout = () => {
    // TODO: wire up actual auth/session sign-out
  };

  const metaString = `${userProfile.role} • ${userProfile.daysRemaining} days • ${userProfile.tasksCount} tasks • ${userProfile.tokensLeft} tokens left`;

  return (
    <header className="flex h-[68px] w-full items-center justify-between border-b border-border bg-surface px-4">
      {/* Left: logo, divider, workspace switcher */}
      <div className="flex items-center gap-4">
        <div className="flex items-center rounded-lg bg-primary px-3 py-2 shadow-soft">
          <Image
            src="/images/cei-logo-name.png"
            alt="CEI"
            width={88}
            height={32}
            priority
            className="h-8 w-auto object-contain"
          />
        </div>

        <span className="h-7 w-px bg-border" aria-hidden="true" />

        <WorkspaceSwitcher
          workspaces={workspaces}
          selectedId={activeWorkspaceId}
          onSelect={setActiveWorkspaceId}
          onCreate={() => {
            const name = prompt("Enter new workspace name:");
            if (name?.trim()) {
              addWorkspace(name.trim());
            }
          }}
        />
      </div>

      {/* Right: user profile, theme toggle, logout */}
      <div className="flex items-center gap-5">
        <UserProfile
          name={userProfile.name}
          meta={metaString}
        />
        <ThemeToggle />
        <Button icon={LogoutIcon} onClick={handleLogout}>
          Logout
        </Button>
      </div>
    </header>
  );
}
