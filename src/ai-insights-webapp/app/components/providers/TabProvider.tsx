"use client";

import React, {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

export function createTabContext<T extends string | undefined>() {
  type TabContextType = {
    activeTab: T;
    tabswitcher: (tab: T) => void;
  };

  const TabContext = createContext<TabContextType | undefined>(undefined);

  function TabProvider({
    children,
    initialTab,
  }: {
    children: ReactNode;
    initialTab: T;
  }) {
    const [activeTab, setActiveTab] = useState<T>(initialTab);

    const tabswitcher = (newTab: T) => {
      setActiveTab(newTab);
    };

    return (
      <TabContext.Provider value={{ activeTab, tabswitcher }}>
        {children}
      </TabContext.Provider>
    );
  }

  function useTab<T>(tab: T): TabContextType {
    const context = useContext(TabContext);

    if (!context) {
      throw new Error("useTab must be used within a TabProvider");
    }

    return context;
  }

  return {
    TabProvider,
    useTab,
  };
}
