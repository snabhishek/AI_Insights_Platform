import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectorRouter from "./routes/connectors";
import { initializeDatabase } from "./db";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for frontend workspace
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Main routers
app.use("/api/connectors", connectorRouter);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.listen(PORT, async () => {
  console.log(`[Server] AI Insights Backend listening at http://localhost:${PORT}`);
  await initializeDatabase();
});
