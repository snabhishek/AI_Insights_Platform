"use client";

import React from "react";
import { useTab } from "./components/providers/TabProvider";
import ProjectsPage from "./components/pages/ProjectsPage";
import DataSourcePage from "./components/pages/DataSourcePage";
import SettingsPage from "./components/pages/SettingsPage";
import AdminConfigPage from "./components/pages/AdminConfigPage";

export default function Home() {
  const { activeTab } = useTab();

  switch (activeTab) {
    case "data-source":
      return <DataSourcePage />;
    case "settings":
      return <SettingsPage />;
    case "admin-config":
      return <AdminConfigPage />;
    case "projects":
    default:
      return <ProjectsPage />;
  }
}
