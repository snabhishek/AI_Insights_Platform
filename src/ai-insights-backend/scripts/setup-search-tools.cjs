#!/usr/bin/env node
/**
 * Setup DuckDuckGo and You.com Search Tools in LiteLLM Proxy.
 * Invoked by installer (setup-deps.ps1) using packaged node.exe.
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

const proxyUrl = (process.argv[2] || process.env.LITELLM_PROXY_URL)?.replace(/\/+$/, "");
const masterKey = process.argv[3] || process.env.LITELLM_MASTER_KEY;

if (!proxyUrl || !masterKey) {
  console.error("[LiteLLM Tools] Missing required arguments: <proxyUrl> <masterKey>");
  process.exit(1);
}

function request(endpoint, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(`${proxyUrl}${endpoint}`);
      const client = parsed.protocol === "https:" ? https : http;
      const req = client.request(
        parsed,
        {
          method: options.method || "GET",
          headers: {
            Authorization: `Bearer ${masterKey}`,
            "Content-Type": "application/json",
            ...(options.headers || {}),
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null, raw: data });
            } catch {
              resolve({ status: res.statusCode, data: null, raw: data });
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
      if (body) {
        req.write(typeof body === "string" ? body : JSON.stringify(body));
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function setupSearchTools() {
  console.log(`[LiteLLM Tools] Checking configured search tools at ${proxyUrl}...`);
  const listRes = await request("/search_tools/list");
  if (listRes.status < 200 || listRes.status >= 300) {
    console.error(`[LiteLLM Tools] Failed to list search tools (status ${listRes.status}): ${listRes.raw}`);
    process.exit(1);
  }

  const existing = Array.isArray(listRes.data?.search_tools)
    ? listRes.data.search_tools.map((t) => (t.search_tool_name || "").toLowerCase())
    : [];

  console.log(`[LiteLLM Tools] Current search tools: ${existing.length ? existing.join(", ") : "none"}`);

  const toolsToSetup = [
    {
      name: "duckduckgo",
      payload: {
        search_tool: {
          search_tool_name: "duckduckgo",
          litellm_params: {
            search_provider: "duckduckgo",
          },
          search_tool_info: {
            description: "DuckDuckGo web search tool",
          },
        },
      },
    },
    {
      name: "you_com",
      payload: {
        search_tool: {
          search_tool_name: "you_com",
          litellm_params: {
            search_provider: "you_com",
          },
          search_tool_info: {
            description: "You.com web search tool",
          },
        },
      },
    },
  ];

  for (const tool of toolsToSetup) {
    if (existing.includes(tool.name)) {
      console.log(`[LiteLLM Tools] Tool '${tool.name}' is already configured in LiteLLM.`);
      continue;
    }

    console.log(`[LiteLLM Tools] Registering '${tool.name}' tool in LiteLLM...`);
    const createRes = await request("/search_tools", { method: "POST" }, tool.payload);
    if (createRes.status >= 200 && createRes.status < 300) {
      console.log(`[LiteLLM Tools] Successfully registered '${tool.name}' tool.`);
    } else {
      console.error(`[LiteLLM Tools] Failed to register '${tool.name}' (status ${createRes.status}): ${createRes.raw}`);
      process.exit(1);
    }
  }

  console.log("[LiteLLM Tools] All search tools verified and configured.");
  process.exit(0);
}

setupSearchTools().catch((err) => {
  console.error(`[LiteLLM Tools] Error configuring search tools: ${err.message || err}`);
  process.exit(1);
});
