import "./proxy.js";
import type { Screenshot } from "./dataset.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15000;
const CACHE_DIR = process.env.SCREENSHOT_CACHE_DIR ?? join(process.cwd(), "data", "cache");
const IMAGE_CACHE_DIR = join(CACHE_DIR, "images");
const IMAGE_CACHE_TTL_MS = Number(process.env.IMAGE_CACHE_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);
const MAX_JPEG_WIDTH = Number(process.env.SCREENSHOT_JPEG_WIDTH ?? 1400);
const JPEG_QUALITY = Number(process.env.SCREENSHOT_JPEG_QUALITY ?? 78);

function log(event: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ ts: new Date().toISOString(), level: "info", component: "screenshot-images", event, ...details }));
}

function cachePath(screenshot: Screenshot) {
  const key = createHash("sha256").update(`${screenshot.id}\n${screenshot.url}`).digest("hex");
  return join(IMAGE_CACHE_DIR, `${key}.jpg`);
}

async function readCachedImage(path: string): Promise<{ bytes: Buffer; ageMs: number } | undefined> {
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    return { bytes, ageMs: Date.now() - info.mtimeMs };
  } catch { return undefined; }
}

async function fetchAndCacheImage(screenshot: Screenshot, path: string): Promise<Buffer> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    // Do not log signed query parameters from upstream URLs.
    log("image_fetch_start", { id: screenshot.id, host: new URL(screenshot.url).host, timeoutMs: IMAGE_TIMEOUT_MS });
    const response = await fetch(screenshot.url, { redirect: "follow", signal: controller.signal });
    const mimeType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    log("image_fetch_response", { id: screenshot.id, status: response.status, mimeType, declaredLength: declaredLength || null, finalHost: response.url ? new URL(response.url).host : null, durationMs: Date.now() - started });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(mimeType)) throw new Error(`unsupported content-type: ${mimeType || "missing"}`);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error(`image exceeds ${MAX_IMAGE_BYTES} bytes (content-length)`);
    const source = Buffer.from(await response.arrayBuffer());
    if (!source.length) throw new Error("empty image body");
    if (source.length > MAX_IMAGE_BYTES) throw new Error(`image exceeds ${MAX_IMAGE_BYTES} bytes (actual size)`);

    const jpeg = await sharp(source, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: MAX_JPEG_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    await mkdir(IMAGE_CACHE_DIR, { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, jpeg);
    await rename(temp, path);
    log("image_cache_write", { id: screenshot.id, originalBytes: source.length, jpegBytes: jpeg.length, widthLimit: MAX_JPEG_WIDTH, quality: JPEG_QUALITY, durationMs: Date.now() - started });
    return jpeg;
  } finally {
    clearTimeout(timer);
  }
}

export async function screenshotContent(screenshots: Screenshot[]) {
  const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
    { type: "text", text: JSON.stringify({ count: screenshots.length, screenshots }, null, 2) }
  ];
  log("batch_start", { count: screenshots.length, maxImageBytes: MAX_IMAGE_BYTES, timeoutMs: IMAGE_TIMEOUT_MS, cacheTtlMs: IMAGE_CACHE_TTL_MS });

  const results = await Promise.all(screenshots.map(async (screenshot) => {
    const started = Date.now();
    const path = cachePath(screenshot);
    const cached = await readCachedImage(path);
    if (cached && cached.ageMs < IMAGE_CACHE_TTL_MS) {
      log("image_cache_hit", { id: screenshot.id, bytes: cached.bytes.length, ageMs: cached.ageMs });
      return { screenshot, image: { type: "image" as const, data: cached.bytes.toString("base64"), mimeType: "image/jpeg" } };
    }
    if (cached) log("image_cache_stale", { id: screenshot.id, bytes: cached.bytes.length, ageMs: cached.ageMs });
    try {
      const bytes = await fetchAndCacheImage(screenshot, path);
      log("image_fetch_success", { id: screenshot.id, bytes: bytes.length, base64Bytes: Math.ceil(bytes.length / 3) * 4, durationMs: Date.now() - started });
      return { screenshot, image: { type: "image" as const, data: bytes.toString("base64"), mimeType: "image/jpeg" } };
    } catch (error) {
      if (cached) {
        log("image_stale_cache_fallback", { id: screenshot.id, bytes: cached.bytes.length, ageMs: cached.ageMs, error: error instanceof Error ? error.message : String(error) });
        return { screenshot, image: { type: "image" as const, data: cached.bytes.toString("base64"), mimeType: "image/jpeg" } };
      }
      const message = error instanceof Error ? error.message : String(error);
      log("image_fetch_failure", { id: screenshot.id, error: message, durationMs: Date.now() - started });
      return { screenshot, error: message };
    }
  }));

  let included = 0;
  let totalImageBytes = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const result of results) {
    if (result.image) {
      content.push(result.image);
      included++;
      totalImageBytes += Buffer.from(result.image.data, "base64").length;
    } else failures.push({ id: result.screenshot.id, error: result.error ?? "unknown image fetch error" });
  }
  content[0] = { type: "text", text: JSON.stringify({ count: screenshots.length, imageBlocksReturned: included, screenshots, ...(failures.length ? { imageFetchFailures: failures } : {}) }, null, 2) };
  log("batch_complete", { requested: screenshots.length, imageBlocksReturned: included, failed: failures.length, totalImageBytes, contentBlocks: content.length });
  return content;
}
