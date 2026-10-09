import { Client, Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const dbHost = process.env.DB_HOST!;
const dbPort = parseInt(process.env.DB_PORT!, 10);
const dbUser = process.env.DB_USER!;
const dbPass = process.env.DB_PASS!;
const dbName = process.env.DB_NAME!;

export const pool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPass,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export async function initializeApplicationData() {
  try {
    console.log("[DB] Initializing application data...");

    await query(`
      INSERT INTO workspaces (id, name, is_default, created_at)
      VALUES ('default', 'Default Workspace', TRUE, NOW())
      ON CONFLICT (id) DO NOTHING;
    `);

    await query(`
      UPDATE connectors SET workspace_id = 'default' WHERE workspace_id IS NULL;
    `);

    try {
      await query(`
        UPDATE projects SET status = 'stopped' WHERE status = 'running';
        UPDATE project_runs SET status = 'stopped', agent_state = jsonb_set(agent_state, '{status}', '"stopped"') WHERE status = 'running';
        UPDATE sparrow_chat_messages SET payload=payload || jsonb_build_object(
          'status','stopped','isThinking',false,'content','Agent was stopped','thinking',
          COALESCE((SELECT jsonb_agg(CASE WHEN step->>'done'='true' THEN step ELSE step || '{"status":"stopped"}'::jsonb END)
            FROM jsonb_array_elements(COALESCE(payload->'thinking','[]'::jsonb)) step),'[]'::jsonb))
          WHERE payload->>'status'='sending';
      `);
    } catch (cleanErr: any) {
      console.warn("[DB] Startup sanitization warning:", cleanErr?.message || cleanErr);
    }

    await query(`INSERT INTO model_source_types (id, name, description) VALUES
      ('builtin', 'Built-in Model', 'Platform native algorithms and baseline implementations'),
      ('external', 'External Model Source', 'Models discovered dynamically from external web and repository sources')
      ON CONFLICT (id) DO NOTHING`);

    const connCheck = await query("SELECT COUNT(*) FROM connectors");
    const count = parseInt(connCheck.rows[0].count, 10);
    if (count === 0) {
      console.log("[DB] Seeding 18 mock connectors for high-fidelity demonstration...");

      const seedConnectors = [
        {
          id: "conn-1",
          name: "PostgreSQL Production",
          subtext: "Database",
          type: "postgres",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:14 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ host: "127.0.0.1", port: "5432", database: "prod_db", username: "pg_user" }),
          assets: JSON.stringify({ tables: 42, views: 8, pipelines: 3 })
        },
        {
          id: "conn-2",
          name: "Snowflake Warehouse",
          subtext: "Data Warehouse",
          type: "snowflake",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "09:30 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ account: "cei_snowflake", warehouse: "analytics_wh" }),
          assets: JSON.stringify({ tables: 110, views: 24, pipelines: 5 })
        },
        {
          id: "conn-3",
          name: "BigQuery Analytics",
          subtext: "Data Warehouse",
          type: "snowflake",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "11:05 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ project_id: "google-bigquery-poc" }),
          assets: JSON.stringify({ tables: 85, views: 12, pipelines: 4 })
        },
        {
          id: "conn-4",
          name: "SQL Server - Finance",
          subtext: "Database",
          type: "sqlserver",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "08:45 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ host: "sql-finance.cei.internal", database: "finance_records" }),
          assets: JSON.stringify({ tables: 56, views: 5, pipelines: 2 })
        },
        {
          id: "conn-5",
          name: "S3 / Cloud Storage",
          subtext: "Cloud Storage",
          type: "excel",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "07:15 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ bucket: "cei-datalake-s3" }),
          assets: JSON.stringify({ tables: 14, views: null, pipelines: 1 })
        },
        {
          id: "conn-6",
          name: "REST API - Customer Service",
          subtext: "API",
          type: "restapi",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:50 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ url: "https://api.cei.com/v1/customers", method: "GET" }),
          assets: JSON.stringify({ tables: 8, views: null, pipelines: 2 })
        },
        {
          id: "conn-7",
          name: "MySQL Inventory",
          subtext: "Database",
          type: "mysql",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "03:12 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "127.0.0.1", database: "inventory_db" }),
          assets: JSON.stringify({ tables: 18, views: 0, pipelines: 1 })
        },
        {
          id: "conn-8",
          name: "MongoDB Users",
          subtext: "Database",
          type: "mongodb",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "01:22 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "localhost", database: "user_metadata" }),
          assets: JSON.stringify({ tables: 10, views: null, pipelines: 0 })
        },
        {
          id: "conn-9",
          name: "Excel Sales Data",
          subtext: "File",
          type: "excel",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "11:30 AM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ fileName: "sales_q2_2026.xlsx" }),
          assets: JSON.stringify({ tables: 3, views: null, pipelines: 1 })
        },
        {
          id: "conn-10",
          name: "CSV Analytics Log",
          subtext: "File",
          type: "csv",
          status: "Connected",
          health: "Warning",
          last_sync_time: "09:15 AM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ fileName: "user_clicks.csv" }),
          assets: JSON.stringify({ tables: 1, views: null, pipelines: 2 })
        },
        {
          id: "conn-11",
          name: "TSV Product Catalog",
          subtext: "File",
          type: "tsv",
          status: "Disconnected",
          health: "Warning",
          last_sync_time: "08:00 AM",
          last_sync_date: "July 10, 2026",
          connection_config: JSON.stringify({ fileName: "products.tsv" }),
          assets: JSON.stringify({ tables: 1, views: null, pipelines: 1 })
        },
        {
          id: "conn-12",
          name: "REST API - Payments",
          subtext: "API",
          type: "restapi",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:10 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ url: "https://payments.cei.com/history" }),
          assets: JSON.stringify({ tables: 12, views: null, pipelines: 3 })
        },
        {
          id: "conn-13",
          name: "PostgreSQL Dev",
          subtext: "Database",
          type: "postgres",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "04:30 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "dev-db-pg" }),
          assets: JSON.stringify({ tables: 28, views: 4, pipelines: 2 })
        },
        {
          id: "conn-14",
          name: "Snowflake Archive",
          subtext: "Data Warehouse",
          type: "snowflake",
          status: "Disconnected",
          health: "Error",
          last_sync_time: "02:00 PM",
          last_sync_date: "July 08, 2026",
          connection_config: JSON.stringify({ account: "cei_archive" }),
          assets: JSON.stringify({ tables: 200, views: 50, pipelines: 8 })
        },
        {
          id: "conn-15",
          name: "MySQL Log Store",
          subtext: "Database",
          type: "mysql",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "11:55 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "logdb-prod" }),
          assets: JSON.stringify({ tables: 8, views: 0, pipelines: 1 })
        },
        {
          id: "conn-16",
          name: "MongoDB Sessions",
          subtext: "Database",
          type: "mongodb",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:00 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ database: "sessions" }),
          assets: JSON.stringify({ tables: 4, views: null, pipelines: 1 })
        },
        {
          id: "conn-17",
          name: "CSV HR Records",
          subtext: "File",
          type: "csv",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "09:00 AM",
          last_sync_date: "July 09, 2026",
          connection_config: JSON.stringify({ fileName: "hr_salary.csv" }),
          assets: JSON.stringify({ tables: 2, views: null, pipelines: 1 })
        },
        {
          id: "conn-18",
          name: "SQL Server - HR",
          subtext: "Database",
          type: "sqlserver",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "08:15 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ database: "hr_sql" }),
          assets: JSON.stringify({ tables: 34, views: 3, pipelines: 2 })
        }
      ];

      for (const conn of seedConnectors) {
        await query(
          `INSERT INTO connectors (id, name, subtext, type, status, health, last_sync_time, last_sync_date, created_at, connection_config, assets, workspace_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, 'default')`,
          [conn.id, conn.name, conn.subtext, conn.type, conn.status, conn.health, conn.last_sync_time, conn.last_sync_date, conn.connection_config, conn.assets]
        );
      }
      console.log("[DB] Seeding mock connectors completed successfully.");
    }

    const domCheck = await query("SELECT COUNT(*) FROM domains");
    const domCount = parseInt(domCheck.rows[0].count, 10);
    if (domCount === 0) {
      console.log("[DB] Seeding standard business domains and sub-domains...");
      const seedDomains = [
        {
          id: "dom-1",
          domain: "Retail & E-Commerce",
          sub_domains: JSON.stringify([
            "Order Management",
            "Inventory & Stock Control",
            "Customer & Loyalty Analytics",
            "Pricing & Promotions",
            "E-Commerce Fulfillment",
          ]),
        },
        {
          id: "dom-2",
          domain: "Finance & Banking",
          sub_domains: JSON.stringify([
            "Risk Management",
            "Fraud Detection",
            "Credit & Loan Origination",
            "Wealth Management",
            "Transaction Auditing",
          ]),
        },
        {
          id: "dom-3",
          domain: "Healthcare & Life Sciences",
          sub_domains: JSON.stringify([
            "Patient Health Records",
            "Clinical Trial Analytics",
            "Hospital Operations",
            "Medical Billing & Claims",
            "Pharmaceutical Supply",
          ]),
        },
        {
          id: "dom-4",
          domain: "Supply Chain & Logistics",
          sub_domains: JSON.stringify([
            "Demand Forecasting & Planning",
            "Warehouse Operations",
            "Freight & Transportation",
            "Supplier Performance",
            "Procurement & Sourcing",
          ]),
        },
        {
          id: "dom-5",
          domain: "Manufacturing",
          sub_domains: JSON.stringify([
            "Quality Assurance & Control",
            "Equipment Predictive Maintenance",
            "Production Line Optimization",
            "Material Requirements Planning",
            "Safety & Compliance",
          ]),
        },
        {
          id: "dom-6",
          domain: "Energy & Utilities",
          sub_domains: JSON.stringify([
            "Smart Grid Analytics",
            "Asset Performance Management",
            "Energy Consumption Forecasting",
            "Environmental Monitoring",
          ]),
        },
        {
          id: "dom-7",
          domain: "Telecommunications",
          sub_domains: JSON.stringify([
            "Network Performance Monitoring",
            "Subscriber Churn Prediction",
            "Billing & Rating Systems",
            "Customer Experience Analytics",
          ]),
        },
        {
          id: "dom-8",
          domain: "Other",
          sub_domains: JSON.stringify([
            "General Business Analytics",
          ]),
        },
      ];

      for (const dom of seedDomains) {
        await query(
          `INSERT INTO domains (id, domain, sub_domains, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [dom.id, dom.domain, dom.sub_domains]
        );
      }
      console.log("[DB] Seeding business domains completed successfully.");
    }

    const seedChatSuggestions = [
      {
        id: "sugg-1",
        suggestion: "Summarize the overall health and status of my active projects",
        category: "General",
        display_order: 1,
      },
      {
        id: "sugg-2",
        suggestion: "Inspect Data Quality & Null Ratios",
        category: "Data Quality",
        display_order: 2,
      },
      {
        id: "sugg-3",
        suggestion: "Suggest High-Impact Features for demand forecasting",
        category: "Feature Engineering",
        display_order: 3,
      },
      {
        id: "sugg-4",
        suggestion: "Compare candidate ML models and explain selection criteria",
        category: "Model Diagnostics",
        display_order: 4,
      },
    ];

    for (const item of seedChatSuggestions) {
      await query(
        `INSERT INTO chat_suggestions (id, suggestion, category, display_order, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           suggestion = EXCLUDED.suggestion,
           category = EXCLUDED.category,
           display_order = EXCLUDED.display_order,
           updated_at = NOW()`,
        [item.id, item.suggestion, item.category, item.display_order]
      );
    }
    console.log("[DB] Post-deployment seeding of chat suggestions completed.");

    console.log("[DB] Application data initialization completed.");
  } catch (err: any) {
    console.error("[DB] Failed to initialize application data:", err);
    throw err;
  }
}

export async function checkAndCreateDatabase() {

  const client = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: "postgres",
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });

  try {
    await client.connect();

    const checkRes = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );

    if (checkRes.rows.length === 0) {
      console.log(`[DB] Database "${dbName}" does not exist. Creating database...`);

      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[DB] Database "${dbName}" created successfully.`);
    } else {
      console.log(`[DB] Database "${dbName}" verified successfully.`);
    }

  } catch (err: any) {
    console.error("[DB] Database verification/creation guard failed:", err);
    throw err;
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }
}

// The baseline is a real, additive migration for both fresh and legacy databases.
// A separate journal preserves the retired migration history without pretending
// those historical scripts ran on installations initialized by legacy SQL.
export async function runMigrations(databasePool: Pool = pool, migrationsSchema = "drizzle") {
  const client = await databasePool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('application-schema-migrations'))");
    locked = true;
    await migrate(drizzle(client), {
      migrationsFolder: path.join(__dirname, "db/migrations/sql"),
      migrationsSchema,
      migrationsTable: "__application_migrations",
    });
    console.log("[DB] Application schema migrations completed.");
  } catch (error) {
    console.error("[DB] Application migration failed:", error);
    throw error;
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('application-schema-migrations'))");
      client.release();
    } catch (error) {
      client.release(true);
      throw error;
    }
  }
}
