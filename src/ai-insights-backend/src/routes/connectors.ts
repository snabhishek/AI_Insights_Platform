import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import * as db from "../store/inMemoryStore";
import { testConnection, healthCheck } from "../services/connectionTester";

const router = Router();

// GET /api/connectors - List all connected sources
router.get("/", async (req: Request, res: Response) => {
  try {
    const list = await db.getAll();
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to list connectors" });
  }
});

// POST /api/connectors/test - Test connection config (without saving)
router.post("/test", async (req: Request, res: Response) => {
  const { type, config } = req.body;

  if (!type) {
    res.status(400).json({ success: false, message: "Connector type is required" });
    return;
  }

  try {
    const result = await testConnection(type, config || {});
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Internal test error" });
  }
});

// POST /api/connectors - Add/Save new connector after testing
router.post("/", async (req: Request, res: Response) => {
  const { name, type, subtext, config } = req.body;

  if (!name || !type || !subtext) {
    res.status(400).json({ success: false, message: "Missing required fields (name, type, subtext)" });
    return;
  }

  try {
    // Perform one final connection validation before saving
    const test = await testConnection(type, config || {});
    if (!test.success) {
      res.status(400).json({ success: false, message: `Validation failed: ${test.message}` });
      return;
    }

    const newConnector = await db.add(name, type, subtext, config || {});
    res.status(201).json(newConnector);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to add connector" });
  }
});

// GET /api/connectors/:id/schema - Retrieve tables/views dynamically
router.get("/:id/schema", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const connector = await db.getById(id);
    if (!connector) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }

    if (connector.type === "postgres") {
      const config = connector.connectionConfig;
      const targetPool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });

      const schemaRes = await targetPool.query(`
        SELECT table_name as name, table_type as type 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      const tablesList = [];
      for (const row of schemaRes.rows) {
        let rowCount = 0;
        try {
          const countRes = await targetPool.query(`SELECT count(*)::int as count FROM "${row.name}"`);
          rowCount = countRes.rows[0]?.count ?? 0;
        } catch (e) {
          rowCount = 0;
        }
        tablesList.push({
          id: row.name,
          name: row.name,
          type: row.type === "VIEW" ? "View" : "Table",
          rows: rowCount,
        });
      }

      await targetPool.end();
      res.json({ success: true, type: "database", tables: tablesList });
      return;
    }

    if (connector.type === "mysql") {
      const config = connector.connectionConfig;
      const mysql = require("mysql2/promise");
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 3306,
        database: config.database,
        user: config.username || "root",
        password: config.password || "",
      });

      const [schemaRows] = await connection.query(`
        SELECT table_name as name, table_type as type 
        FROM information_schema.tables 
        WHERE table_schema = ? 
        ORDER BY table_name
      `, [config.database]);

      const tablesList = [];
      for (const row of (schemaRows as any[])) {
        let rowCount = 0;
        try {
          const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${row.name}\``);
          rowCount = (countRows as any)[0]?.count ?? 0;
        } catch (e) {
          rowCount = 0;
        }
        tablesList.push({
          id: row.name,
          name: row.name,
          type: row.type === "VIEW" ? "View" : "Table",
          rows: rowCount,
        });
      }

      await connection.end();
      res.json({ success: true, type: "database", tables: tablesList });
      return;
    }

    if (connector.type === "excel") {
      const fileName = connector.connectionConfig.fileName;
      if (fileName) {
        const filePath = path.join(process.cwd(), "uploads", fileName);
        if (fs.existsSync(filePath)) {
          const xlsx = require("xlsx");
          const workbook = xlsx.readFile(filePath);
          const tablesList = workbook.SheetNames.map((sheetName: string) => {
            const sheet = workbook.Sheets[sheetName];
            const ref = sheet["!ref"] || "A1:A1";
            const range = xlsx.utils.decode_range(ref);
            const rowCount = range.e.r - range.s.r;
            return {
              id: sheetName,
              name: sheetName,
              type: "Table",
              rows: Math.max(0, rowCount),
            };
          });
          res.json({ success: true, type: "file", tables: tablesList });
          return;
        }
      }
    }

    if (["csv", "tsv"].includes(connector.type)) {
      const fileName = connector.connectionConfig.fileName;
      let rowCount = 50000;
      if (fileName) {
        const filePath = path.join(process.cwd(), "uploads", fileName);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf8");
          rowCount = content.split(/\r?\n/).filter((line) => line.trim().length > 0).length - 1;
        }
      }
      res.json({
        success: true,
        type: "file",
        tables: [
          { id: fileName || "file_data", name: fileName || "File Data", type: "Table", rows: Math.max(0, rowCount) }
        ]
      });
      return;
    }

    if (connector.type === "restapi") {
      res.json({
        success: true,
        type: "api",
        tables: [
          { id: "api_endpoint", name: "API Endpoint", type: "Endpoint", rows: 1 }
        ]
      });
      return;
    }

    res.json({ success: true, type: "generic", tables: [] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to query schema" });
  }
});

// GET /api/connectors/:id/preview - Retrieve live preview rows for databases or local files
router.get("/:id/preview", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const tableName = req.query.table as string;

  try {
    const connector = await db.getById(id);
    if (!connector) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }

    if (connector.type === "postgres") {
      if (!tableName) {
        res.status(400).json({ success: false, message: "Table parameter is required for database previews" });
        return;
      }

      const config = connector.connectionConfig;
      const targetPool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });

      // Verify table name exists to protect against injection
      const tableCheck = await targetPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        [tableName]
      );
      if (tableCheck.rows.length === 0) {
        await targetPool.end();
        res.status(400).json({ success: false, message: `Table "${tableName}" not found or unauthorized` });
        return;
      }

      const dataRes = await targetPool.query(`SELECT * FROM "${tableName}" LIMIT 5`);
      await targetPool.end();

      const headers = dataRes.fields.map((f) => f.name);
      const rows = dataRes.rows;

      res.json({ success: true, headers, rows });
      return;
    }


    if (connector.type === "mysql") {
      if (!tableName) {
        res.status(400).json({ success: false, message: "Table parameter is required for database previews" });
        return;
      }

      const config = connector.connectionConfig;
      const mysql = require("mysql2/promise");
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 3306,
        database: config.database,
        user: config.username || "root",
        password: config.password || "",
      });

      // Verify table name exists to protect against injection
      const [tableCheck] = await connection.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
        [config.database, tableName]
      );
      if ((tableCheck as any[]).length === 0) {
        await connection.end();
        res.status(400).json({ success: false, message: `Table "${tableName}" not found or unauthorized` });
        return;
      }

      const [dataRows, fields] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT 5`);
      await connection.end();

      const headers = (fields as any[]).map((f) => f.name);
      res.json({ success: true, headers, rows: dataRows });
      return;
    }

    if (connector.type === "excel") {
      const fileName = connector.connectionConfig.fileName;
      if (!fileName) {
        res.status(400).json({ success: false, message: "No file associated with connector" });
        return;
      }

      const uploadDir = path.join(process.cwd(), "uploads");
      const filePath = path.join(uploadDir, fileName);

      if (!fs.existsSync(filePath)) {
        res.json({
          success: true,
          headers: ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"],
          rows: [
            { col1: "Fallback row 1", col2: "—", col3: "—", col4: "—", col5: "—" }
          ]
        });
        return;
      }

      const xlsx = require("xlsx");
      const workbook = xlsx.readFile(filePath);
      const sheetName = tableName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        res.status(400).json({ success: false, message: `Sheet "${sheetName}" not found in workbook` });
        return;
      }

      const jsonRows = xlsx.utils.sheet_to_json(worksheet, { defval: "" }) as any[];
      if (jsonRows.length === 0) {
        res.json({ success: true, headers: [], rows: [] });
        return;
      }

      const headers = Object.keys(jsonRows[0]);
      const rows = jsonRows.slice(0, 5);

      res.json({ success: true, headers, rows });
      return;
    }

    if (["csv", "tsv"].includes(connector.type)) {
      const fileName = connector.connectionConfig.fileName;
      if (!fileName) {
        res.status(400).json({ success: false, message: "No file associated with connector" });
        return;
      }

      const uploadDir = path.join(process.cwd(), "uploads");
      const filePath = path.join(uploadDir, fileName);

      if (!fs.existsSync(filePath)) {
        res.json({
          success: true,
          headers: ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"],
          rows: [
            { col1: "Fallback row 1", col2: "—", col3: "—", col4: "—", col5: "—" }
          ]
        });
        return;
      }

      const content = fs.readFileSync(filePath, "utf8");
      const delimiter = connector.type === "tsv" ? "\t" : ",";
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

      if (lines.length === 0) {
        res.json({ success: true, headers: [], rows: [] });
        return;
      }

      const headers = lines[0].split(delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim());
      const rows = lines.slice(1, 6).map((line) => {
        const parts = line.split(delimiter).map((p) => p.replace(/^["']|["']$/g, "").trim());
        const rowObj: Record<string, string> = {};
        headers.forEach((header, idx) => {
          rowObj[header] = parts[idx] || "";
        });
        return rowObj;
      });

      res.json({ success: true, headers, rows });
      return;
    }

    if (connector.type === "restapi") {
      res.json({
        success: true,
        headers: ["Endpoint", "Status", "Latency"],
        rows: [
          { endpoint: connector.connectionConfig.url || "api_endpoint", status: "200 OK", latency: "12ms" }
        ],
      });
      return;
    }

    res.json({ success: true, headers: [], rows: [] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to query preview" });
  }
});

// POST /api/connectors/:id/sync - Sync schema metadata for a database
router.post("/:id/sync", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const connector = await db.getById(id);

    if (!connector) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }

    // Set to syncing state
    await db.updateStatus(id, "Syncing");

    // Simulate parsing tables/metadata in background
    setTimeout(async () => {
      try {
        // Re-run health validation
        const test = await healthCheck(connector.type, connector.connectionConfig);
        
        await db.updateStatus(id, "Connected");
        await db.updateHealth(id, test.success ? "Healthy" : "Warning");
      } catch (err) {
        await db.updateStatus(id, "Connected");
        await db.updateHealth(id, "Error");
      }
    }, 1500);

    res.json({ success: true, message: "Sync started" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to sync" });
  }
});

// POST /api/connectors/:id/disconnect - Set status to Disconnected
router.post("/:id/disconnect", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const updated = await db.updateStatus(id, "Disconnected");
    if (!updated) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to disconnect" });
  }
});

// POST /api/connectors/sync-all - Sync all databases
router.post("/sync-all", async (req: Request, res: Response) => {
  try {
    const connectors = await db.getAll();
    
    if (connectors.length === 0) {
      res.json({ success: true, message: "No connectors to sync" });
      return;
    }

    await db.updateAllStatus("Syncing");

    setTimeout(async () => {
      await db.completeAllSync();
    }, 2000);

    res.json({ success: true, message: "Syncing all connectors" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to sync all" });
  }
});

// GET /api/connectors/:id/health - Query real-time health check on connector
router.get("/:id/health", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const connector = await db.getById(id);

    if (!connector) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }

    const check = await healthCheck(connector.type, connector.connectionConfig);
    const healthState = check.success ? "Healthy" : "Warning";
    
    await db.updateHealth(id, healthState);
    res.json({
      success: check.success,
      health: healthState,
      message: check.message,
      latencyMs: check.latencyMs,
    });
  } catch (error: any) {
    await db.updateHealth(id, "Error");
    res.status(500).json({ success: false, health: "Error", message: error.message });
  }
});

// GET /api/connectors/:id - Get detail view
router.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const connector = await db.getById(id);
    if (!connector) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }
    res.json(connector);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to get connector" });
  }
});

// DELETE /api/connectors/:id - Delete connection
router.delete("/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const deleted = await db.remove(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }
    res.json({ success: true, message: "Connector deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to delete connector" });
  }
});

// POST /api/connectors/:id/connect - Reconnect/mount data source
router.post("/:id/connect", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const updated = await db.updateStatus(id, "Connected");
    if (!updated) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to connect" });
  }
});

// PUT /api/connectors/:id - Update connection name and parameter details
router.put("/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, config } = req.body;

  if (!name) {
    res.status(400).json({ success: false, message: "Name is required" });
    return;
  }

  try {
    const connector = await db.getById(id);
    if (!connector) {
      res.status(404).json({ success: false, message: "Connector not found" });
      return;
    }

    const mergedConfig = { ...connector.connectionConfig, ...config };
    const updated = await db.updateConnectorConfig(id, name, mergedConfig);
    if (!updated) {
      res.status(500).json({ success: false, message: "Failed to update config" });
      return;
    }
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to update connector" });
  }
});

export default router;
