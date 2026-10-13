import "./proxy.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATASET = process.env.HF_DATASET_ID ?? "for1096/songs";
const API = `https://huggingface.co/api/datasets/${DATASET}/tree/main`;
const CACHE_DIR = process.env.SCREENSHOT_CACHE_DIR ?? join(process.cwd(), "data", "cache");
const INVENTORY_CACHE = join(CACHE_DIR, "dataset-inventory.json");
const INVENTORY_TTL_MS = Number(process.env.DATASET_CACHE_TTL_MS ?? 5 * 60 * 1000);
const STALE_INVENTORY_MAX_AGE_MS = Number(process.env.DATASET_STALE_MAX_AGE_MS ?? 7 * 24 * 60 * 60 * 1000);

type HubEntry = { type?: string; path?: string; size?: number; oid?: string };
type InventoryCache = { savedAt: number; dataset: string; entries: HubEntry[] };
let inventoryPromise: Promise<HubEntry[]> | undefined;

function logDataset(event: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ ts: new Date().toISOString(), level: "info", component: "screenshot-dataset", event, ...details }));
}

async function readInventoryCache(): Promise<InventoryCache | undefined> {
  try {
    const value = JSON.parse(await readFile(INVENTORY_CACHE, "utf8")) as InventoryCache;
    if (value.dataset === DATASET && Array.isArray(value.entries) && Number.isFinite(value.savedAt)) return value;
  } catch { /* cache is absent or invalid; refresh from Hugging Face */ }
  return undefined;
}

async function writeInventoryCache(entries: HubEntry[]) {
  await mkdir(CACHE_DIR, { recursive: true });
  const temp = `${INVENTORY_CACHE}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ savedAt: Date.now(), dataset: DATASET, entries } satisfies InventoryCache));
  await rename(temp, INVENTORY_CACHE);
}

async function listFiles(path = "", depth = 0): Promise<HubEntry[]> {
  if (depth > 4) return [];
  const url = new URL(API);
  url.searchParams.set("recursive", "false");
  url.searchParams.set("expand", "false");
  if (path) url.pathname += `/${path.split("/").map(encodeURIComponent).join("/")}`;
  const started = Date.now();
  logDataset("list_files_start", { path: path || ".", depth, host: url.host });
  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "screen-resolver-mcp/0.1" }, signal: AbortSignal.timeout(20000) });
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
    const nestedErrors = cause && typeof cause === "object" && "errors" in cause && Array.isArray((cause as { errors?: unknown }).errors)
      ? (cause as { errors: Array<{ code?: string; message?: string; address?: string; port?: number }> }).errors.map(item => ({ code: item.code, message: item.message, address: item.address, port: item.port }))
      : [];
    logDataset("list_files_network_error", { path: path || ".", depth, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error), cause: cause instanceof Error ? { name: cause.name, message: cause.message, code: (cause as Error & { code?: string }).code, errors: nestedErrors } : cause });
    throw new Error(`Hugging Face API network request failed at ${path || "."}: ${error instanceof Error ? error.message : String(error)}`);
  }
  logDataset("list_files_response", { path: path || ".", depth, status: response.status, durationMs: Date.now() - started });
  if (!response.ok) throw new Error(`Hugging Face API returned ${response.status} at ${path || "."}`);
  const entries = await response.json() as HubEntry[];
  logDataset("list_files_parsed", { path: path || ".", depth, entries: entries.length, directories: entries.filter(e => e.type === "directory").length, files: entries.filter(e => e.type !== "directory").length });
  const nested = await Promise.all(entries.filter(e => e.type === "directory" && e.path)
    .map(e => listFiles(e.path!, depth + 1)));
  return [...entries.filter(e => e.type !== "directory"), ...nested.flat()];
}

async function refreshInventory(): Promise<HubEntry[]> {
  if (inventoryPromise) {
    logDataset("inventory_refresh_joined");
    return inventoryPromise;
  }
  inventoryPromise = (async () => {
    const started = Date.now();
    try {
      const entries = await listFiles();
      await writeInventoryCache(entries);
      logDataset("inventory_refresh_complete", { durationMs: Date.now() - started, entries: entries.length });
      return entries;
    } finally {
      inventoryPromise = undefined;
    }
  })();
  return inventoryPromise;
}

async function getInventory(): Promise<HubEntry[]> {
  const cached = await readInventoryCache();
  const ageMs = cached ? Date.now() - cached.savedAt : Number.POSITIVE_INFINITY;
  if (cached && ageMs < INVENTORY_TTL_MS) {
    logDataset("inventory_cache_hit", { ageMs, entries: cached.entries.length });
    return cached.entries;
  }
  // Serve stale inventory immediately while refreshing in the background. This prevents a slow
  // Hugging Face API from consuming the MCP client's request timeout after the first warm-up.
  if (cached && ageMs < STALE_INVENTORY_MAX_AGE_MS) {
    logDataset("inventory_stale_cache_served", { ageMs, entries: cached.entries.length });
    void refreshInventory().catch(error => logDataset("inventory_background_refresh_failed", { error: error instanceof Error ? error.message : String(error) }));
    return cached.entries;
  }
  try {
    return await refreshInventory();
  } catch (error) {
    logDataset("inventory_refresh_failed_without_cache", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export type Screenshot = { id: string; url: string };

export async function getScreenshotTotalCount(): Promise<number> {
  const entries = await getInventory();
  return entries.filter(e => e.path && /\.(png|jpe?g|webp|gif|bmp)$/i.test(e.path)).length;
}

export async function getScreenshots(count = 4, excludeIds: string[] = []): Promise<Screenshot[]> {
  const entries = await getInventory();
  const images = entries.filter(e => e.path && /\.(png|jpe?g|webp|gif|bmp)$/i.test(e.path))
    .sort((a, b) => a.path!.localeCompare(b.path!, undefined, { numeric: true }));
  logDataset("image_inventory", { dataset: DATASET, totalEntries: entries.length, imageCount: images.length });
  if (images.length === 0) throw new Error("No image files found in the Hugging Face dataset.");
  const excluded = new Set(excludeIds);
  const available = images.filter(image => !excluded.has(image.path!));
  const pool = available.length ? available : images;
  const cursor = Number(process.env.SCREENSHOT_START ?? "0");
  const start = ((cursor % pool.length) + pool.length) % pool.length;
  const chosen = Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i) % pool.length]!);
  return chosen.map(e => ({
    id: e.path!,
    url: `https://huggingface.co/datasets/${DATASET}/resolve/main/${e.path!.split("/").map(encodeURIComponent).join("/")}`
  }));
}
