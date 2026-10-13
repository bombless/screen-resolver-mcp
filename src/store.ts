import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = resolve(process.env.DATA_DIR ?? "data", "songs.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS recognition_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL DEFAULT 'chatgpt',
    note TEXT
  );
  CREATE TABLE IF NOT EXISTS song_recognitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES recognition_batches(id),
    screenshot_id TEXT NOT NULL,
    screenshot_url TEXT NOT NULL,
    song_title TEXT NOT NULL,
    artist TEXT NOT NULL,
    confidence REAL,
    raw_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_song_title ON song_recognitions(song_title);
  CREATE INDEX IF NOT EXISTS idx_song_artist ON song_recognitions(artist);
  CREATE INDEX IF NOT EXISTS idx_screenshot ON song_recognitions(screenshot_id);
  CREATE TABLE IF NOT EXISTS screenshot_deliveries (
    screenshot_id TEXT PRIMARY KEY,
    delivered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type Recognition = {
  screenshotId: string;
  screenshotUrl: string;
  songTitle: string;
  artist: string;
  confidence?: number;
};

export function appendRecognitions(items: Recognition[], note?: string) {
  const insertBatch = db.prepare("INSERT INTO recognition_batches (note) VALUES (?)");
  const insertSong = db.prepare(`
    INSERT INTO song_recognitions
      (batch_id, screenshot_id, screenshot_url, song_title, artist, confidence, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const transaction = db.transaction(() => {
    const batch = insertBatch.run(note ?? null);
    for (const item of items) {
      insertSong.run(
        batch.lastInsertRowid, item.screenshotId, item.screenshotUrl,
        item.songTitle.trim(), item.artist.trim(), item.confidence ?? null,
        JSON.stringify(item)
      );
    }
    return Number(batch.lastInsertRowid);
  });
  return transaction();
}

export function listRecognitions(options: { q?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const q = options.q?.trim();
  if (q) {
    const needle = `%${q}%`;
    return db.prepare(`
      SELECT r.*, b.submitted_at, b.source
      FROM song_recognitions r JOIN recognition_batches b ON b.id = r.batch_id
      WHERE r.song_title LIKE ? OR r.artist LIKE ? OR r.screenshot_id LIKE ?
      ORDER BY r.id DESC LIMIT ? OFFSET ?
    `).all(needle, needle, needle, limit, offset);
  }
  return db.prepare(`
    SELECT r.*, b.submitted_at, b.source
    FROM song_recognitions r JOIN recognition_batches b ON b.id = r.batch_id
    ORDER BY r.id DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

export function getStats() {
  return {
    recognitions: (db.prepare("SELECT COUNT(*) AS n FROM song_recognitions").get() as { n: number }).n,
    batches: (db.prepare("SELECT COUNT(*) AS n FROM recognition_batches").get() as { n: number }).n,
    uniqueScreenshots: (db.prepare("SELECT COUNT(DISTINCT screenshot_id) AS n FROM song_recognitions").get() as { n: number }).n
  };
}

export function getSubmittedScreenshotIds(): string[] {
  return (db.prepare("SELECT DISTINCT screenshot_id FROM song_recognitions").all() as Array<{ screenshot_id: string }>).map(row => row.screenshot_id);
}

export function getDeliveredScreenshotIds(): string[] {
  return (db.prepare("SELECT screenshot_id FROM screenshot_deliveries").all() as Array<{ screenshot_id: string }>).map(row => row.screenshot_id);
}

export function markScreenshotsDelivered(ids: string[]) {
  const insert = db.prepare("INSERT OR IGNORE INTO screenshot_deliveries (screenshot_id) VALUES (?)");
  const transaction = db.transaction(() => ids.forEach(id => insert.run(id)));
  transaction();
}
