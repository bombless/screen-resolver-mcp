const DATASET = process.env.HF_DATASET_ID ?? "for1096/songs";
const API = `https://huggingface.co/api/datasets/${DATASET}/tree/main`;

type HubEntry = { type?: string; path?: string; size?: number; oid?: string };

async function listFiles(path = "", depth = 0): Promise<HubEntry[]> {
  if (depth > 4) return [];
  const url = new URL(API);
  url.searchParams.set("recursive", "false");
  url.searchParams.set("expand", "false");
  if (path) url.pathname += `/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { headers: { "User-Agent": "screen-resolver-mcp/0.1" } });
  if (!response.ok) throw new Error(`Hugging Face API returned ${response.status}`);
  const entries = await response.json() as HubEntry[];
  const nested = await Promise.all(entries.filter(e => e.type === "directory" && e.path)
    .map(e => listFiles(e.path!, depth + 1)));
  return [...entries.filter(e => e.type !== "directory"), ...nested.flat()];
}

export type Screenshot = { id: string; url: string };

export async function getScreenshots(count = 20): Promise<Screenshot[]> {
  const entries = await listFiles();
  const images = entries.filter(e => e.path && /\.(png|jpe?g|webp|gif|bmp)$/i.test(e.path))
    .sort((a, b) => a.path!.localeCompare(b.path!, undefined, { numeric: true }));
  if (images.length === 0) throw new Error("No image files found in the Hugging Face dataset.");
  // Stable order means repeated calls can be resumed by using screenshot IDs from prior results.
  const cursor = Number(process.env.SCREENSHOT_START ?? "0");
  const start = ((cursor % images.length) + images.length) % images.length;
  const chosen = Array.from({ length: Math.min(count, images.length) }, (_, i) => images[(start + i) % images.length]!);
  return chosen.map(e => ({
    id: e.path!,
    url: `https://huggingface.co/datasets/${DATASET}/resolve/main/${e.path!.split("/").map(encodeURIComponent).join("/")}`
  }));
}