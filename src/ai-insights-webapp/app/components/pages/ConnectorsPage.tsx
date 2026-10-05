"use client";

import React, { useState } from "react";
import DataHealthOverview from "../connectors/DataHealthOverview";
import ConnectorLibrary from "../connectors/ConnectorLibrary";
import ConnectedSources from "../connectors/ConnectedSources";
import ConnectionModal from "../connectors/ConnectionModal";
import SourceDetailModal from "../connectors/SourceDetailModal";
import { useApp, DataSource } from "../providers/AppContext";

export default function ConnectorsPage() {
  const { addDataSource } = useApp();
  const [activeConnectType, setActiveConnectType] = useState<DataSource["type"] | null>(null);
  const [viewingSource, setViewingSource] = useState<DataSource | null>(null);

  return (
    <div className="px-6 py-8 flex flex-col gap-8">

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-3">
          <DataHealthOverview />
        </div>
        <div className="lg:col-span-9">
          <ConnectorLibrary onSelectConnector={setActiveConnectType} />
        </div>
      </div>

      <div className="w-full">
        <ConnectedSources onViewDetails={setViewingSource} />
      </div>

      {activeConnectType && (
        <ConnectionModal
          type={activeConnectType}
          onClose={() => setActiveConnectType(null)}
          onConnect={(name, subtext, config) => addDataSource(name, activeConnectType, subtext, config)}
        />
      )}

      {viewingSource && (
        <SourceDetailModal
          source={viewingSource}
          onClose={() => setViewingSource(null)}
        />
      )}
    </div>
  );
}
