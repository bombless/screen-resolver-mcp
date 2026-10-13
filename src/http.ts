import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getScreenshots } from "./dataset.js";
import { screenshotContent } from "./images.js";
import { appendRecognitions } from "./store.js";

function createServer() {
  const server = new McpServer({ name: "screen-resolver-mcp", version: "0.1.0" });
  server.tool("get_screenshots",
    "Fetch up to 4 KTV song-list screenshots from the for1096/songs Hugging Face dataset. Return screenshot IDs, image URLs, and MCP image content blocks for visual inspection.",
    {},
    async () => {
      try {
        const screenshots = await getScreenshots(4);
        return { content: await screenshotContent(screenshots) };
      } catch (error) {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", component: "get-screenshots", event: "tool_failed", error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }));
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  server.tool("submit_song_recognitions",
    "Append model-recognized song titles and artists for screenshots previously returned by get_screenshots. Existing observations are never overwritten or deduplicated.",
    { recognitions: z.array(z.object({
      screenshotId: z.string().min(1), screenshotUrl: z.string().url(),
      songTitle: z.string().min(1), artist: z.string().min(1),
      confidence: z.number().min(0).max(1).optional()
    })).min(1), note: z.string().optional() },
    async ({ recognitions, note }) => {
      try {
        const batchId = appendRecognitions(recognitions, note);
        return { content: [{ type: "text", text: JSON.stringify({ saved: recognitions.length, batchId, appendOnly: true }, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  return server;
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.get("/health", (_req, res) => res.json({ ok: true, name: "screen-resolver-mcp" }));
app.post("/mcp", async (req, res) => {
  const requestId = randomUUID();
  const started = Date.now();
  console.info(JSON.stringify({ ts: new Date().toISOString(), level: "info", component: "mcp-http", event: "request_start", requestId, method: req.method, path: req.path, contentType: req.headers["content-type"], accept: req.headers.accept, bodyMethod: req.body?.method, rpcId: req.body?.id }));
  res.on("finish", () => console.info(JSON.stringify({ ts: new Date().toISOString(), level: "info", component: "mcp-http", event: "request_finish", requestId, status: res.statusCode, durationMs: Date.now() - started, responseBytes: res.getHeader("content-length") ?? null })));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  res.on("close", () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", component: "mcp-http", event: "request_error", requestId, durationMs: Date.now() - started, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }));
    if (!res.headersSent) res.status(500).json({ error: error instanceof Error ? error.message : String(error), requestId });
  }
});
const port = Number(process.env.MCP_PORT ?? 8787);
app.listen(port, () => console.log(`Streamable HTTP MCP listening on http://localhost:${port}/mcp`));
