import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const webSearchTool = new DuckDuckGoSearch({ maxResults: 5 });

export const createWebSearchTool = () => {
  return tool(
    async (arg: { query: string; tableList?: any }) => {
      try {
        const searchQuery = typeof arg === "string" ? arg : (arg?.query || "");
        if (!searchQuery || searchQuery.trim().length === 0) {
          return "Please provide a valid query to search.";
        }
        const searchResults = await webSearchTool.invoke(searchQuery);
        return typeof searchResults === "string" ? searchResults : JSON.stringify(searchResults);
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

export const createWeBSearchTool = createWebSearchTool;