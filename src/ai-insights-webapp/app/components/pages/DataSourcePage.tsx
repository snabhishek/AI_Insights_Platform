"use client";

import React, { useState } from "react";
import DataHealthOverview from "../datasource/DataHealthOverview";
import ConnectorLibrary from "../datasource/ConnectorLibrary";
import ConnectedSources from "../datasource/ConnectedSources";
import ConnectionModal from "../datasource/ConnectionModal";
import SourceDetailModal from "../datasource/SourceDetailModal";
import { useApp, DataSource } from "../providers/AppContext";

export default function DataSourcePage() {
  const { addDataSource } = useApp();
  const [activeConnectType, setActiveConnectType] = useState<DataSource["type"] | null>(null);
  const [viewingSource, setViewingSource] = useState<DataSource | null>(null);

  return (
    <div className="px-6 py-8 flex flex-col gap-8">
      {/* Top section: Health and Connectors */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-3">
          <DataHealthOverview />
        </div>
        <div className="lg:col-span-9">
          <ConnectorLibrary onSelectConnector={setActiveConnectType} />
        </div>
      </div>

      {/* Connected Sources */}
      <div className="w-full">
        <ConnectedSources onViewDetails={setViewingSource} />
      </div>

      {/* Connection Modal Overlay */}
      {activeConnectType && (
        <ConnectionModal
          type={activeConnectType}
          onClose={() => setActiveConnectType(null)}
          onConnect={(name, subtext, config) => addDataSource(name, activeConnectType, subtext, config)}
        />
      )}

      {/* Detail Modal Overlay */}
      {viewingSource && (
        <SourceDetailModal
          source={viewingSource}
          onClose={() => setViewingSource(null)}
        />
      )}
    </div>
  );
}
