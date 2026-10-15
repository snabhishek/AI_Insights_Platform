import { TavilySearch } from "@langchain/tavily";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

let _webSearchTool: TavilySearch | null = null;
const getWebSearchTool = () => {
  if (!_webSearchTool && process.env.TAVILY_API_KEY) {
    _webSearchTool = new TavilySearch({ maxResults: 5, tavilyApiKey: process.env.TAVILY_API_KEY });
  }
  return _webSearchTool;
};

export const webSearchTool = {
  invoke: async (input: any, options?: any) => {
    const toolInstance = getWebSearchTool();
    if (!toolInstance) {
      const q = typeof input === "string" ? input : input?.query || "";
      return JSON.stringify({
        query: q,
        message: `Web search executed for query: "${q}". No Tavily API key configured for live retrieval.`,
        results: [],
      });
    }
    return toolInstance.invoke(input, options);
  },
} as any;

let searchQueueChain = Promise.resolve<any>(undefined);
let lastSearchTime = 0;
const SEARCH_COOLDOWN_MS = 2500;

export const createWebSearchTool = () => {
  return tool(
    async (arg: { query: string; tableList?: any }) => {
      try {
        const searchQuery = typeof arg === "string" ? arg : (arg?.query || "");
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
          const res = await webSearchTool.invoke({ query: searchQuery }, {recursionLimit: 1});
          return typeof res === "string" ? res : JSON.stringify(res);
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
      description: "Search the web for external datasets, public APIs, macroeconomic indicators, weather data, or domain benchmarks relevant to tables and feature engineering.",
      schema: z.object({
        query: z.string().describe("Query to search the web for external data sources or benchmarks"),
        tableList: z.any().optional().describe("Optional list of table names or context related to the search"),
      }),
    }
  );
};
