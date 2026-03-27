require("dotenv").config();
const express = require("express");
const Minio = require("minio");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors({ exposedHeaders: ["Content-Range"] }));
app.use(express.json());

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "minio";
const MINIO_PORT = parseInt(process.env.MINIO_PORT || "9000", 10);
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === "true";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
const BUCKET = process.env.MINIO_BUCKET || "screenshots";
const PUBLIC_URL_BASE =
  process.env.PUBLIC_URL_BASE || "https://ss.chakshu.com/s3/screenshots";
const PORT = parseInt(process.env.PORT || "3001", 10);

const mc = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

function objectUrl(name) {
  return PUBLIC_URL_BASE + "/" + encodeURIComponent(name);
}

function listAllObjects() {
  return new Promise((resolve, reject) => {
    const items = [];
    const stream = mc.listObjectsV2(BUCKET, "", true);
    stream.on("data", (obj) => items.push(obj));
    stream.on("end", () => resolve(items));
    stream.on("error", reject);
  });
}

// --- List screenshots ---
app.get("/api/screenshots", async (req, res) => {
  try {
    const _start = parseInt(req.query._start || "0", 10);
    const _end = parseInt(req.query._end || "25", 10);
    const _sort = req.query._sort || "lastModified";
    const _order = (req.query._order || "DESC").toUpperCase();
    const q = req.query.q || "";

    let items = await listAllObjects();

    // Map to response shape
    items = items.map((obj) => ({
      id: obj.name,
      name: obj.name,
      size: obj.size,
      lastModified: obj.lastModified,
      url: objectUrl(obj.name),
    }));

    // Filter by search query
    if (q) {
      const lower = q.toLowerCase();
      items = items.filter((i) => i.name.toLowerCase().includes(lower));
    }

    // Sort
    items.sort((a, b) => {
      let va = a[_sort];
      let vb = b[_sort];
      if (_sort === "lastModified") {
        va = new Date(va).getTime();
        vb = new Date(vb).getTime();
      }
      if (typeof va === "string") {
        va = va.toLowerCase();
        vb = vb.toLowerCase();
      }
      if (va < vb) return _order === "ASC" ? -1 : 1;
      if (va > vb) return _order === "ASC" ? 1 : -1;
      return 0;
    });

    const total = items.length;
    const page = items.slice(_start, _end);

    res.set("Content-Range", `screenshots ${_start}-${_end - 1}/${total}`);
    res.json({ data: page, total });
  } catch (err) {
    console.error("GET /api/screenshots error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Get single screenshot ---
app.get("/api/screenshots/:key", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const stat = await mc.statObject(BUCKET, key);
    res.json({
      id: key,
      name: key,
      size: stat.size,
      lastModified: stat.lastModified,
      url: objectUrl(key),
    });
  } catch (err) {
    console.error("GET /api/screenshots/:key error:", err);
    if (err.code === "NotFound") {
      return res.status(404).json({ error: "Not found" });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- Delete screenshot ---
app.delete("/api/screenshots/:key", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    await mc.removeObject(BUCKET, key);
    res.json({ id: key });
  } catch (err) {
    console.error("DELETE /api/screenshots/:key error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Serve React Admin SPA from ./public
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Startup ---
async function start() {
  // Ensure bucket exists
  const exists = await mc.bucketExists(BUCKET);
  if (!exists) {
    await mc.makeBucket(BUCKET);
    console.log(`Created bucket: ${BUCKET}`);
  }

  // Set public-read policy (anonymous GET on objects)
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      },
    ],
  };
  await mc.setBucketPolicy(BUCKET, JSON.stringify(policy));
  console.log(`Bucket policy set to public-read for ${BUCKET}`);

  app.listen(PORT, () => {
    console.log(`ss-manager API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
