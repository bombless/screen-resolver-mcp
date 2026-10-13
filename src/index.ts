import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getScreenshots } from "./dataset.js";
import { screenshotContent } from "./images.js";
import { appendRecognitions } from "./store.js";

const server = new McpServer({ name: "screen-resolver-mcp", version: "0.1.0" });

server.tool(
  "get_screenshots",
  "Fetch a batch of up to 20 KTV song-list screenshots (default 8). Inspect every returned image, then submit all recognized songs in one submit_song_recognitions call before fetching another batch.",
  { count: z.number().int().min(1).max(20).optional().default(8) },
  async ({ count }) => {
    try {
      const screenshots = await getScreenshots(count);
      const content = await screenshotContent(screenshots);
      content[0] = { type: "text", text: JSON.stringify({ count: screenshots.length, requestedCount: count, screenshots }, null, 2) };
      return { content };
    } catch (error) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", component: "get-screenshots", event: "tool_failed", error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }));
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
  }
);

server.tool(
  "submit_song_recognitions",
  "Persist the song titles and artists identified in a previously fetched batch of screenshots. Supply one entry per recognized song, using the exact screenshot ID and URL returned by get_screenshots. Every submission is appended as a new historical batch; existing results are never overwritten or deduplicated.",
  {
    recognitions: z.array(z.object({
      screenshotId: z.string().min(1),
      screenshotUrl: z.string().url(),
      songTitle: z.string().min(1),
      artist: z.string().min(1),
      confidence: z.number().min(0).max(1).optional()
    })).min(1),
    note: z.string().optional()
  },
  async ({ recognitions, note }) => {
    try {
      const batchId = appendRecognitions(recognitions, note);
      return { content: [{ type: "text", text: JSON.stringify({
        saved: recognitions.length, batchId, appendOnly: true,
        message: "Recognition results appended. No previous records were modified."
      }, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);