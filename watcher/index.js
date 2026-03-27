import { config } from "dotenv";
import { watch } from "chokidar";
import * as Minio from "minio";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG_DIR = join(homedir(), ".ss-manager");
const ENV_PATH = join(CONFIG_DIR, ".env");
const TRACKING_PATH = join(CONFIG_DIR, "uploaded.json");

config({ path: ENV_PATH });

const {
  MINIO_ENDPOINT,
  MINIO_PORT = "443",
  MINIO_USE_SSL = "true",
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_BUCKET = "screenshots",
  WATCH_DIR,
} = process.env;

const watchDir = (WATCH_DIR || join(homedir(), "Desktop")).replace(
  "$HOME",
  homedir()
);

if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY || !MINIO_ENDPOINT) {
  console.error(
    `[ss-manager] Missing MinIO config. Edit ${ENV_PATH} and set credentials.`
  );
  process.exit(1);
}

// ── MinIO client ────────────────────────────────────────────────────────────
const mc = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: parseInt(MINIO_PORT, 10),
  useSSL: MINIO_USE_SSL === "true",
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

const BUCKET = MINIO_BUCKET;
const SCREENSHOT_RE = /^Screenshot.*\.png$/;

// ── Tracking (persisted across restarts) ────────────────────────────────────
let uploaded = new Set();

async function loadTracking() {
  try {
    if (existsSync(TRACKING_PATH)) {
      const data = JSON.parse(await readFile(TRACKING_PATH, "utf-8"));
      uploaded = new Set(Array.isArray(data) ? data : []);
      console.log(`[ss-manager] Loaded ${uploaded.size} previously uploaded files`);
    }
  } catch {
    uploaded = new Set();
  }
}

async function saveTracking() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(TRACKING_PATH, JSON.stringify([...uploaded], null, 2));
}

// ── Upload logic ────────────────────────────────────────────────────────────
async function uploadFile(filePath, attempt = 1) {
  const filename = basename(filePath);
  const t0 = Date.now();

  if (uploaded.has(filename)) {
    return; // already uploaded
  }

  try {
    // Brief delay so macOS finishes writing the file
    await sleep(300);

    const buf = await readFile(filePath);

    await mc.putObject(BUCKET, filename, buf, buf.length, {
      "Content-Type": "image/png",
    });

    const elapsed = Date.now() - t0;
    uploaded.add(filename);
    await saveTracking();

    console.log(
      `[ss-manager] Uploaded ${filename} -> s3://${BUCKET}/${filename}  (${elapsed}ms)`
    );
  } catch (err) {
    const elapsed = Date.now() - t0;
    if (attempt < 2) {
      console.warn(
        `[ss-manager] Upload failed for ${filename} (${elapsed}ms), retrying... ${err.message}`
      );
      await sleep(500);
      return uploadFile(filePath, attempt + 1);
    }
    console.error(
      `[ss-manager] Upload failed permanently for ${filename} after ${elapsed}ms: ${err.message}`
    );
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Startup: scan existing screenshots that may have been missed ────────────
async function scanExisting() {
  try {
    const files = await readdir(watchDir);
    const screenshots = files.filter(
      (f) => SCREENSHOT_RE.test(f) && !uploaded.has(f)
    );

    if (screenshots.length > 0) {
      console.log(
        `[ss-manager] Found ${screenshots.length} un-uploaded screenshot(s) on startup`
      );
      for (const f of screenshots) {
        await uploadFile(join(watchDir, f));
      }
    }
  } catch (err) {
    console.error(`[ss-manager] Error scanning existing files: ${err.message}`);
  }
}

// ── Ensure bucket exists ────────────────────────────────────────────────────
async function ensureBucket() {
  try {
    const exists = await mc.bucketExists(BUCKET);
    if (!exists) {
      await mc.makeBucket(BUCKET);
      console.log(`[ss-manager] Created bucket "${BUCKET}"`);
    }
  } catch (err) {
    console.error(
      `[ss-manager] Could not verify/create bucket "${BUCKET}": ${err.message}`
    );
    // Non-fatal: uploads will fail with a clear error
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[ss-manager] Starting at ${new Date().toISOString()}`);
  console.log(`[ss-manager] Watching: ${watchDir}`);
  console.log(`[ss-manager] MinIO:    ${MINIO_ENDPOINT}:${MINIO_PORT}/${BUCKET}`);

  await loadTracking();
  await ensureBucket();
  await scanExisting();

  const watcher = watch(watchDir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: false, // we handle the delay ourselves for speed
  });

  watcher.on("add", (filePath) => {
    const filename = basename(filePath);
    if (SCREENSHOT_RE.test(filename)) {
      const detected = Date.now();
      console.log(
        `[ss-manager] Detected: ${filename} at ${new Date(detected).toISOString()}`
      );
      uploadFile(filePath);
    }
  });

  watcher.on("error", (err) => {
    console.error(`[ss-manager] Watcher error: ${err.message}`);
  });

  console.log("[ss-manager] Watcher running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error(`[ss-manager] Fatal: ${err.message}`);
  process.exit(1);
});
