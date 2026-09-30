"use client";

import React from "react";
import { createTabContext } from "./components/providers/TabProvider";
import ProjectsPage from "./components/pages/ProjectsPage";
import ConnectorsPage from "./components/pages/ConnectorsPage";
import AIAgentChatPage from "./components/pages/AIAgentChatPage";
import { PageType } from "./components/shared/constants";
import Header from "./components/shared/header/Header";
import Navbar from "./components/shared/navbar/Navbar";

export default function Home() {
  const { TabProvider, useTab } = createTabContext<PageType>()

  return (
    <>
      <TabProvider initialTab="projects">
        <Header />
        <Navbar useTab={useTab} />
        <TabContent useTab={useTab} />
      </TabProvider>
    </>
  )
}

// Helper component to render content based on active tab
function TabContent({ useTab }: { useTab: <T>(tab: T) => any }) {
  const { activeTab } = useTab("projects");

  switch (activeTab) {
    case "connectors":
      return <ConnectorsPage />;
    case "ai-agent-chat":
      return <AIAgentChatPage />;
    case "switcher":
      return null;
    case "projects":
    default:
      return <ProjectsPage />;
  }
}

