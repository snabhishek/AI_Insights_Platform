import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();

const dbUser = process.env.DB_USER || "postgres";
const dbPass = process.env.DB_PASS || "";
const dbHost = process.env.DB_HOST || "localhost";
const dbPort = process.env.DB_PORT || "5434";
const dbName = process.env.DB_NAME || "AIInsightsApp";

// Construct PostgreSQL connection URL dynamically
const connectionString = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;

export default defineConfig({
  schema: "./src/db/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
