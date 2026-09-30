"use client";

import { ReactNode } from "react";
import { createTabContext } from "../../providers/TabProvider";
import { PageType } from "../constants";

interface NavItem {
  id: PageType;
  label: string;
  icon: ReactNode;
}

const iconProps = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const NAV_ITEMS: NavItem[] = [
  {
    id: "projects",
    label: "Projects",
    icon: (
      <svg {...iconProps}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "connectors",
    label: "Connectors",
    icon: (
      <svg {...iconProps}>
        <path d="M12 22v-5" />
        <path d="M9 8V2" />
        <path d="M15 8V2" />
        <path d="M18 8v5a6 6 0 0 1-12 0V8z" />
      </svg>
    ),
  },
  {
    id: "ai-agent-chat",
    label: "AI Agent Chat",
    icon: (
      <svg {...iconProps}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <circle cx="9" cy="10" r="1" fill="currentColor" />
        <circle cx="12" cy="10" r="1" fill="currentColor" />
        <circle cx="15" cy="10" r="1" fill="currentColor" />
      </svg>
    ),
  },
];

export default function Navbar({ useTab }: { useTab: <T>(tab: T) => any}) {
  const { activeTab, tabswitcher } = useTab<PageType>("projects");

  return (
    <nav className="w-full bg-surface px-4">
      <ul className="flex items-center gap-1 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  tabswitcher('switcher');
                  setTimeout(() => {
                    tabswitcher(item.id)
                  }, 100);
                }}
                aria-current={isActive ? "page" : undefined}
                className={`group inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-surface-muted text-primary dark:text-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`transition-transform duration-200 ${
                    isActive ? "scale-110" : "group-hover:scale-110"
                  }`}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
