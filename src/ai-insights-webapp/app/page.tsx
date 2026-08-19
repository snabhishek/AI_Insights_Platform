"use client";

import React from "react";
import { useTab } from "./components/providers/TabProvider";
import ProjectsPage from "./components/pages/ProjectsPage";
import DataSourcePage from "./components/pages/DataSourcePage";
import ApplicationPage from "./components/pages/ApplicationPage";

export default function Home() {
  const { activeTab } = useTab();

  switch (activeTab) {
    case "application":
      return <ApplicationPage />;
    case "data-source":
      return <DataSourcePage />;
    case "projects":
    default:
      return <ProjectsPage />;
  }
}
