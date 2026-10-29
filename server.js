/* eslint-disable no-undef */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const news = require("./lib/news");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.resolve(__dirname, "data.json");
const NEWS_CACHE_MS = Number(process.env.NEWS_CACHE_MINUTES || 30) * 60 * 1000;
const REWRITE_LIMIT_PER_MINUTE = Number(process.env.REWRITE_LIMIT_PER_MINUTE || 10);

const readData = () => {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error reading data file:", error.message);
    return [];
  }
};

const writeData = (newData) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2));
  } catch (error) {
    console.error("Error writing to data file:", error.message);
  }
};

// Very small per-IP fixed-window limiter for the Gemini-backed rewrite route.
function rateLimit(limit, windowMs = 60 * 1000) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    if (entry.count >= limit) {
      return res.status(429).json({ message: "Too many requests" });
    }
    entry.count += 1;
    return next();
  };
}

function createApp(deps = news) {
  const app = express();
  let cache = { at: 0, articles: null };

  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true, // If you're sending cookies or using credentials
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (req, res) => {
    res.send("Hello from the backend!");
  });

  // Fetch the latest headlines, score their mood, store and return them.
  // Results are cached in memory to protect the MediaStack and Gemini quotas.
  app.get("/news", async (req, res) => {
    if (cache.articles && Date.now() - cache.at < NEWS_CACHE_MS) {
      res.set("X-Data-Source", "memory-cache");
      return res.json(cache.articles);
    }
    try {
      const raw = await deps.fetchNews();
      const moods = await deps.scoreMoods(raw.map((n) => n.title));
      const articles = deps.toArticles(raw, moods);
      writeData(articles);
      cache = { at: Date.now(), articles };
      res.set("X-Data-Source", "live");
      return res.json(articles);
    } catch (err) {
      console.error("GET /news failed:", err.service || "", err.status || "", err.message);
      // Serve the last stored articles rather than an empty page.
      const stored = readData().filter((a) => a && a.id !== undefined);
      if (stored.length) {
        res.set("X-Data-Source", "stored");
        return res.json(stored);
      }
      return res.status(502).json({ message: "News is temporarily unavailable" });
    }
  });

  // Rewrite one stored article's title/description to the requested mood.
  app.post("/rewrite", rateLimit(REWRITE_LIMIT_PER_MINUTE), async (req, res) => {
    const id = Number(req.body?.id);
    const mood = Number(req.body?.mood);
    if (!Number.isInteger(id) || !Number.isInteger(mood) || mood < 1 || mood > 10) {
      return res.status(400).json({ message: "id and mood (1-10) are required" });
    }
    const article = readData().find((item) => item.id === id);
    if (!article) return res.status(404).json({ message: "Data not found" });
    try {
      return res.json(await deps.rewriteArticle(article, mood));
    } catch (err) {
      console.error("POST /rewrite failed:", err.service || "", err.status || "", err.message);
      return res.status(502).json({ message: "Rewrite is temporarily unavailable" });
    }
  });

  app.get("/data", (req, res) => {
    const currentData = readData();
    res.json(currentData);
  });

  app.get("/data/:id", (req, res) => {
    const { id } = req.params;
    const currentData = readData();

    // Convert `id` to a number for comparison
    const dataItem = currentData.find((item) => item.id === Number(id));

    if (dataItem) {
      res.json(dataItem);
    } else {
      res.status(404).json({ message: "Data not found" });
    }
  });

  // Kept for backward compatibility with older frontend builds.
  app.post("/initial-mood", (req, res) => {
    const { allData } = req.body;

    if (!allData || !Array.isArray(allData)) {
      return res.status(400).json({ message: "Invalid data format" });
    }

    writeData(allData);

    res.json({ message: "Data overridden successfully", allData });
  });

  return app;
}

if (require.main === module) {
  for (const name of ["MEDIASTACK_ACCESS_KEY", "GEMINI_API_KEY"]) {
    if (!process.env[name]) console.warn(`Warning: ${name} is not set; /news and /rewrite will fail`);
  }
  createApp().listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
