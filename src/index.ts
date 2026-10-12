import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getScreenshots } from "./dataset.js";
import { appendRecognitions } from "./store.js";

const server = new McpServer({ name: "screen-resolver-mcp", version: "0.1.0" });

server.tool(
  "get_screenshots",
  "Fetch the next batch of up to 20 KTV song-list screenshots from the for1096/songs Hugging Face dataset. Return image URLs and stable screenshot IDs for visual inspection.",
  { },
  async () => {
    try {
      const screenshots = await getScreenshots(20);
      return { content: [{ type: "text", text: JSON.stringify({ count: screenshots.length, screenshots }, null, 2) }] };
    } catch (error) {
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