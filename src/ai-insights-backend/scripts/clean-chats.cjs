const { Client } = require("pg");
const path = require("node:path");
const dotenv = require("dotenv");

// Load .env from backend root
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

async function cleanChats() {
  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "AIInsightsApp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASS || "",
  });

  try {
    await client.connect();
    console.log(`[clean-chats] Connected to database: ${process.env.DB_NAME || "AIInsightsApp"}`);

    const preCountMessages = await client.query("SELECT COUNT(*) FROM sparrow_chat_messages;");
    const preCountSessions = await client.query("SELECT COUNT(*) FROM sparrow_chat_sessions;");

    console.log(`[clean-chats] Existing chat messages: ${preCountMessages.rows[0].count}`);
    console.log(`[clean-chats] Existing chat sessions: ${preCountSessions.rows[0].count}`);

    // Cleanly delete all chat messages and chat sessions
    await client.query("TRUNCATE TABLE sparrow_chat_messages, sparrow_chat_sessions CASCADE;");

    console.log("[clean-chats] Successfully truncated sparrow_chat_messages and sparrow_chat_sessions.");

    const postCountMessages = await client.query("SELECT COUNT(*) FROM sparrow_chat_messages;");
    const postCountSessions = await client.query("SELECT COUNT(*) FROM sparrow_chat_sessions;");

    console.log(`[clean-chats] Remaining messages: ${postCountMessages.rows[0].count}`);
    console.log(`[clean-chats] Remaining sessions: ${postCountSessions.rows[0].count}`);
    console.log("[clean-chats] Database chat cleanup complete!");
    console.log("\nNOTE: To also clear cached chats in your browser UI, run this in your browser DevTools Console:");
    console.log('localStorage.removeItem("ai_insights_chat_sessions_v1"); localStorage.removeItem("ai_insights_active_session_key_v2"); location.reload();\n');
  } catch (error) {
    console.error("[clean-chats] Error during cleanup:", error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  cleanChats();
}

module.exports = { cleanChats };
