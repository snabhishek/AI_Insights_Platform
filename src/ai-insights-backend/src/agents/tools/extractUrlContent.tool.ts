import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";

/**
 * Creates the extract_url_content tool for AI Agents.
 * Uses CheerioWebBaseLoader with fallback HTTP fetch sanitization to extract text from URL links.
 */
export const createExtractUrlContentTool = () => {
  return tool(
    async (arg: { url: string; maxChars?: number }) => {
      try {
        const rawUrl = typeof arg === "string" ? arg : arg?.url;
        if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
          return "Please provide a valid HTTP/HTTPS URL.";
        }

        const trimmedUrl = rawUrl.trim();
        if (!/^https?:\/\//i.test(trimmedUrl)) {
          return `Invalid URL protocol: "${trimmedUrl}". URL must start with http:// or https://`;
        }

        const maxChars =
          typeof arg === "object" && typeof arg?.maxChars === "number" && arg.maxChars > 0
            ? arg.maxChars
            : 4000;

        let textContent = "";

        // 1. Try CheerioWebBaseLoader first
        try {
          const loader = new CheerioWebBaseLoader(trimmedUrl);
          const docs = await loader.load();
          if (Array.isArray(docs) && docs.length > 0) {
            textContent = docs.map((d) => d.pageContent || "").join("\n\n").trim();
          }
        } catch (loaderErr: any) {
          // Cheerio loader failed (e.g. anti-scraping, custom headers needed), proceed to fallback
        }

        // 2. Fallback HTTP fetch if Cheerio loader produced empty output
        if (!textContent) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          try {
            const response = await fetch(trimmedUrl, {
              signal: controller.signal,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
              },
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              return `Failed to fetch URL ${trimmedUrl}. HTTP status: ${response.status} ${response.statusText}`;
            }

            const html = await response.text();
            textContent = cleanHtmlToText(html);
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            return `Error fetching URL ${trimmedUrl}: ${fetchErr?.message || String(fetchErr)}`;
          }
        }

        if (!textContent || textContent.trim().length === 0) {
          return `No readable text content could be extracted from URL: ${trimmedUrl}`;
        }

        const cleanedText = textContent
          .replace(/[ \t]+/g, " ")
          .replace(/\n\s*\n+/g, "\n\n")
          .trim();

        if (cleanedText.length > maxChars) {
          return cleanedText.slice(0, maxChars) + `\n\n... [Content truncated at ${maxChars} characters]`;
        }

        return cleanedText;
      } catch (error: any) {
        return `Error extracting content from URL: ${error?.message || String(error)}`;
      }
    },
    {
      name: "extract_url_content",
      description:
        "Extract readable text content from web page URLs (e.g., links obtained from web_search) to analyze documentation, dataset sources, or domain articles.",
      schema: z.object({
        url: z.string().describe("The HTTP or HTTPS URL to extract readable text content from"),
        maxChars: z
          .number()
          .optional()
          .describe("Optional maximum character length of the extracted text (default: 4000)"),
      }),
    }
  );
};

export const extractUrlContentTool = createExtractUrlContentTool();

/**
 * Strips HTML tags, non-content elements, and decodes HTML entities to return clean body text.
 */
function cleanHtmlToText(html: string): string {
  if (!html) return "";
  let text = html;
  text = text.replace(/<script\b[^<]*?>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*?>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript\b[^<]*?>[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg\b[^<]*?>[\s\S]*?<\/svg>/gi, "");
  text = text.replace(/<header\b[^<]*?>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer\b[^<]*?>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<nav\b[^<]*?>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<(?:p|div|br|h[1-6]|li)\b[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return text;
}
