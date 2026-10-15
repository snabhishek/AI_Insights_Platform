import type { ThinkingStep } from "../components/chat/types";

/** Decode SSE incrementally, including split UTF-8 characters and CRLF frames. */
export async function readSparrowStream(response: Response, onThinkingUpdate?: (steps: ThinkingStep[]) => void): Promise<any> {
  if (!response.body) throw new Error("Sparrow returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any;
  const consume = (frame: string) => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const event = JSON.parse(data);
    if (event.type === "thinking" && Array.isArray(event.thinking)) onThinkingUpdate?.(event.thinking);
    else if (event.type === "result") result = event.data;
    else if (event.type === "error") throw new Error(event.error || "Sparrow execution failed.");
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (buffer.length > 8_000_000) throw new Error("Sparrow stream frame exceeded the size limit.");
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!result) throw new Error("The Sparrow connection ended before the final response. Reopen the conversation to recover its saved state.");
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
