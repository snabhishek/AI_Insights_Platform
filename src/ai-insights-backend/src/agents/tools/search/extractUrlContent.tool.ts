import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { chromium, Browser } from "playwright";

/**
 * Creates the extract_url_content tool for AI Agents.
 * Uses Playwright headless Chromium exclusively to execute client-side JavaScript,
 * ensuring dynamic content (e.g., Hugging Face model cards, tags, GitHub READMEs, SPA pages)
 * is fully rendered and extracted.
 */
export const createExtractUrlContentTool = () => {
  return tool(
    async (arg: { url: string; maxChars?: number }) => {
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
          : 6000;

      let browser: Browser | null = null;
      try {
        browser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });

        const context = await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          viewport: { width: 1280, height: 800 },
        });

        const page = await context.newPage();

        // Navigate to the URL and wait for DOM loaded
        await page.goto(trimmedUrl, {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        });

        // Wait for dynamic JavaScript rendering/hydration
        try {
          await page.waitForLoadState("networkidle", { timeout: 7000 });
        } catch {
          // If networkidle times out (common on pages with continuous telemetry), proceed with rendered DOM
        }

        // Extract fully rendered text from the dynamic DOM
        const textContent = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          if (!doc) return "";

          // Remove non-content elements
          const elementsToRemove = doc.querySelectorAll(
            "script, style, noscript, svg, nav, footer, header, iframe"
          );
          elementsToRemove.forEach((el: any) => el.remove());

          // Prefer main article or readme containers if present
          const contentContainer =
            doc.querySelector("article") ||
            doc.querySelector(".markdown-body") ||
            doc.querySelector("main") ||
            doc.body;

          return contentContainer ? (contentContainer.innerText || contentContainer.textContent || "") : (doc.body?.innerText || "");
        });

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
        console.error(`[extractUrlContent] Playwright extraction failed for ${trimmedUrl}:`, error?.message || error);
        return `Error extracting content from URL via Playwright: ${error?.message || String(error)}`;
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch {
            // Ignore close errors
          }
        }
      }
    },
    {
      name: "extract_url_content",
      description:
        "Extract readable text content from web page URLs (e.g., links obtained from web_search) using a headless browser to capture JavaScript-rendered content such as Hugging Face model cards, tags, GitHub repositories, documentation, and benchmark leaderboards.",
      schema: z.object({
        url: z.string().describe("The HTTP or HTTPS URL to extract readable text content from"),
        maxChars: z
          .number()
          .optional()
          .describe("Optional maximum character length of the extracted text (default: 6000)"),
      }),
    }
  );
};

export const extractUrlContentTool = createExtractUrlContentTool();
