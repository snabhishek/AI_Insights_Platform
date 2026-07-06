import net from "net";
import http from "http";
import https from "https";
import { Pool } from "pg";
import { ConnectorType, ConnectionConfig } from "../store/inMemoryStore";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

// ─── Default Ports ─────────────────────────────────────────────────────────────

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433,
  mongodb: 27017,
  snowflake: 443,
};

// ─── TCP Socket Test ───────────────────────────────────────────────────────────

function testTcpConnection(host: string, port: number, timeoutMs = 5000): Promise<TestResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      const latencyMs = Date.now() - startTime;
      socket.destroy();
      resolve({
        success: true,
        message: `TCP connection established to ${host}:${port}`,
        latencyMs,
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        success: false,
        message: `Connection timed out after ${timeoutMs}ms — ${host}:${port} is not reachable`,
        latencyMs: timeoutMs,
      });
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      const latencyMs = Date.now() - startTime;
      let message = `Connection failed to ${host}:${port}`;

      if (err.code === "ECONNREFUSED") {
        message = `Connection refused — no service is listening on ${host}:${port}`;
      } else if (err.code === "ENOTFOUND") {
        message = `Host not found — could not resolve hostname "${host}"`;
      } else if (err.code === "ENETUNREACH") {
        message = `Network unreachable — cannot reach ${host}`;
      } else if (err.message) {
        message = `Connection error: ${err.message}`;
      }

      socket.destroy();
      resolve({ success: false, message, latencyMs });
    });

    socket.connect(port, host);
  });
}

// ─── HTTP/HTTPS Test ───────────────────────────────────────────────────────────

function testHttpConnection(url: string, timeoutMs = 8000): Promise<TestResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;

      const req = client.request(
        url,
        { method: "HEAD", timeout: timeoutMs },
        (res) => {
          const latencyMs = Date.now() - startTime;
          const statusCode = res.statusCode || 0;

          if (statusCode >= 200 && statusCode < 400) {
            resolve({
              success: true,
              message: `API endpoint reachable — HTTP ${statusCode}`,
              latencyMs,
            });
          } else if (statusCode === 401 || statusCode === 403) {
            // Still reachable, just needs auth
            resolve({
              success: true,
              message: `API endpoint reachable — authentication required (HTTP ${statusCode})`,
              latencyMs,
            });
          } else {
            resolve({
              success: false,
              message: `API returned HTTP ${statusCode}`,
              latencyMs,
            });
          }

          res.resume(); // consume the response body
        }
      );

      req.on("timeout", () => {
        req.destroy();
        resolve({
          success: false,
          message: `Request timed out after ${timeoutMs}ms`,
          latencyMs: timeoutMs,
        });
      });

      req.on("error", (err) => {
        const latencyMs = Date.now() - startTime;
        resolve({
          success: false,
          message: `Request failed: ${err.message}`,
          latencyMs,
        });
      });

      req.end();
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : "Invalid URL format";
      resolve({
        success: false,
        message: `Invalid URL: ${message}`,
        latencyMs,
      });
    }
  });
}

// ─── Main Test Function ────────────────────────────────────────────────────────

export async function testConnection(
  type: ConnectorType,
  config: ConnectionConfig
): Promise<TestResult> {
  // File types — validation is client-side only
  if (["excel", "csv", "tsv"].includes(type)) {
    if (!config.fileName) {
      return { success: false, message: "No file selected", latencyMs: 0 };
    }
    return {
      success: true,
      message: `File "${config.fileName}" accepted for import`,
      latencyMs: 1,
    };
  }

  // REST API — HTTP reachability test
  if (type === "restapi") {
    if (!config.url) {
      return { success: false, message: "API endpoint URL is required", latencyMs: 0 };
    }
    return testHttpConnection(config.url);
  }

  // Database types
  if (!config.host) {
    return { success: false, message: "Host address is required", latencyMs: 0 };
  }
  if (!config.database) {
    return { success: false, message: "Database name is required", latencyMs: 0 };
  }

  const port = config.port
    ? parseInt(config.port, 10)
    : DEFAULT_PORTS[type] || 5432;

  if (isNaN(port) || port < 1 || port > 65535) {
    return { success: false, message: "Invalid port number", latencyMs: 0 };
  }

  const startTime = Date.now();

  // Postgres Real DB Handshake
  if (type === "postgres") {
    const pool = new Pool({
      host: config.host,
      port,
      database: config.database,
      user: config.username || "postgres",
      password: config.password || "",
      connectionTimeoutMillis: 5000,
    });
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      await pool.end();
      return {
        success: true,
        message: `Successfully authenticated PostgreSQL connection to ${config.database}`,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      await pool.end();
      return {
        success: false,
        message: `PostgreSQL auth failed: ${err.message}`,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  // MySQL Real DB Handshake
  if (type === "mysql") {
    try {
      const mysql = require("mysql2/promise");
      const connection = await mysql.createConnection({
        host: config.host,
        port,
        database: config.database,
        user: config.username || "root",
        password: config.password || "",
        connectTimeout: 5000,
      });
      await connection.query("SELECT 1");
      await connection.end();
      return {
        success: true,
        message: `Successfully authenticated MySQL connection to ${config.database}`,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `MySQL auth failed: ${err.message}`,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  // Fallback TCP Socket test for other database types
  return testTcpConnection(config.host, port);
}

// ─── Health Check ──────────────────────────────────────────────────────────────

export async function healthCheck(
  type: ConnectorType,
  config: ConnectionConfig
): Promise<TestResult> {
  // Delegate to the same test function
  return testConnection(type, config);
}
