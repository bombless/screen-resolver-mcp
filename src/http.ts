import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getScreenshots } from "./dataset.js";
import { appendRecognitions } from "./store.js";

function createServer() {
  const server = new McpServer({ name: "screen-resolver-mcp", version: "0.1.0" });
  server.tool("get_screenshots",
    "Fetch up to 20 KTV song-list screenshots from the for1096/songs Hugging Face dataset. Return stable screenshot IDs and image URLs.",
    {},
    async () => {
      try {
        const screenshots = await getScreenshots(20);
        return { content: [{ type: "text", text: JSON.stringify({ count: screenshots.length, screenshots }, null, 2) }] };
      } catch (error) {
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
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  res.on("close", () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
const port = Number(process.env.MCP_PORT ?? 8787);
app.listen(port, () => console.log(`Streamable HTTP MCP listening on http://localhost:${port}/mcp`));
