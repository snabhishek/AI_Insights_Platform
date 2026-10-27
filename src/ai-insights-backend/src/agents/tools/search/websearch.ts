import { TavilySearch } from "@langchain/tavily";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// ============================================================================
// Tavily Search Logic (Retained for reference/legacy, but not active in tool)
// ============================================================================
let _tavilySearchTool: TavilySearch | null = null;
export const getTavilySearchTool = () => {
  if (!_tavilySearchTool && process.env.TAVILY_API_KEY) {
    _tavilySearchTool = new TavilySearch({ maxResults: 5, tavilyApiKey: process.env.TAVILY_API_KEY });
  }
  return _tavilySearchTool;
};

// ============================================================================
// Types & Normalization for Web Search
// ============================================================================
export interface WebSearchResultItem {
  title: string;
  url: string;
  link: string;
  snippet: string;
  content: string;
}

export type SearchProvider = "duckduckgo" | "you_com" | "fallback"

export interface WebSearchExecutionResult {
  query: string;
  provider: SearchProvider;
  results: WebSearchResultItem[];
  message?: string;
}

/**
 * Executes a search query through LiteLLM Proxy /v1/search endpoint.
 */
async function queryLiteLLMSearch(
  query: string,
  searchToolName: Exclude<SearchProvider, "fallback">
): Promise<WebSearchResultItem[]> {
  const litellmUrl = process.env.LITELLM_PROXY_URL;
  const litellmKey = process.env.LITELLM_VIRTUAL_KEY || process.env.LITELLM_MASTER_KEY;

  const response = await fetch(`${litellmUrl}/v1/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${litellmKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_tool_name: searchToolName,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LiteLLM search error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  const rawResults = Array.isArray(data?.results) ? data.results : [];

  return rawResults.map((item: any) => ({
    title: item.title || "",
    url: item.url || item.link || "",
    link: item.url || item.link || "",
    snippet: item.snippet || item.content || "",
    content: item.snippet || item.content || "",
  }));
}

/**
 * Searches the web with DuckDuckGo as primary and You.com as fallback.
 */
async function executeSearchWithFallback(query: string): Promise<WebSearchExecutionResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query, provider: "duckduckgo", results: [] };
  }

  // 1. Primary: DuckDuckGo
  try {
    const ddgResults = await queryLiteLLMSearch(trimmed, "duckduckgo");
    if (ddgResults.length > 0) {
      return {
        query: trimmed,
        provider: "duckduckgo",
        results: ddgResults,
      };
    }
    console.log(`[webSearchTool] DuckDuckGo returned 0 results for "${trimmed}". Falling back to You.com...`);
  } catch (ddgError: any) {
    console.warn(`[webSearchTool] DuckDuckGo search failed: ${ddgError?.message || ddgError}. Falling back to You.com...`);
  }

  // 2. Fallback: You.com
  try {
    const youResults = await queryLiteLLMSearch(trimmed, "you_com");
    return {
      query: trimmed,
      provider: "you_com",
      results: youResults,
    };
  } catch (youError: any) {
    console.error(`[webSearchTool] You.com search failed:`, youError?.message || youError);
    return {
      query: trimmed,
      provider: "fallback",
      message: `Search failed on both DuckDuckGo and You.com: ${youError?.message || youError}`,
      results: [],
    };
  }
}

let searchQueueChain = Promise.resolve<any>(undefined);
let lastSearchTime = 0;
const SEARCH_COOLDOWN_MS = 1500;

export const createWebSearchTool = () => {
  return tool(
    async (arg: { query: string; tableList?: any }) => {
      try {
        const searchQuery = typeof arg === "string" ? arg : arg?.query || "";
        if (!searchQuery || searchQuery.trim().length === 0) {
          return "Please provide a valid query to search.";
        }

        const currentSearch = (async () => {
          await searchQueueChain.catch(() => {});

          const now = Date.now();
          const timeSinceLast = now - lastSearchTime;
          if (timeSinceLast < SEARCH_COOLDOWN_MS) {
            const delay = SEARCH_COOLDOWN_MS - timeSinceLast;
            await new Promise((r) => setTimeout(r, delay));
          }

          lastSearchTime = Date.now();
          const searchData = await executeSearchWithFallback(searchQuery);
          return JSON.stringify(searchData);
        })();

        searchQueueChain = currentSearch;

        const searchResults = await currentSearch;
        return searchResults;
      } catch (error: any) {
        return "Error while searching the web: " + (error?.message || JSON.stringify(error));
      }
    },
    {
      name: "web_search",
      description:
        "Search the web for python machine learning documentation, model training APIs, library deprecation notices, error solutions, external datasets, or domain benchmarks.",
      schema: z.object({
        query: z.string().describe("Query to search the web for external data sources, documentation, API updates, or error fixes"),
        tableList: z.any().optional().describe("Optional list of table names or context related to the search"),
      }),
    }
  );
};

export const webSearchTool = createWebSearchTool();
