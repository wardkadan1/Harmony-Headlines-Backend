// API tests with injected fakes: no network, no real API keys needed.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
process.env.DATA_FILE = path.join(tmp, "data.json");

const { createApp } = require("../server");
const news = require("../lib/news");

const raw = [
  { title: "A", image: "a.png", author: "x", published_at: "2026-01-01", description: "da" },
  { title: "B", image: "b.png", author: "y", published_at: "2026-01-02", description: "db" },
];

async function withServer(deps, fn) {
  const server = createApp(deps).listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

function fakeDeps(overrides = {}) {
  const calls = { fetchNews: 0, scoreMoods: 0, rewrite: 0 };
  return {
    calls,
    toArticles: news.toArticles,
    fetchNews: async () => { calls.fetchNews++; return raw; },
    scoreMoods: async (titles) => { calls.scoreMoods++; return titles.map((_, i) => i + 3); },
    rewriteArticle: async (a, mood) => { calls.rewrite++; return { title: `${a.title}!`, description: a.description, mood }; },
    ...overrides,
  };
}

beforeEach(() => fs.writeFileSync(process.env.DATA_FILE, "[]"));

test("GET /news returns scored articles in the frontend's shape and stores them", async () => {
  const deps = fakeDeps();
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/news`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body[0], { id: 0, title: "A", image: "a.png", author: "x", published_at: "2026-01-01", description: "da", mood: 3 });
    assert.equal(body.length, 2);
    const stored = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
    assert.equal(stored.length, 2);
    const one = await (await fetch(`${base}/data/1`)).json();
    assert.equal(one.title, "B");
  });
});

test("GET /news is cached so repeated loads do not spend API quota", async () => {
  const deps = fakeDeps();
  await withServer(deps, async (base) => {
    await fetch(`${base}/news`);
    const res = await fetch(`${base}/news`);
    assert.equal(res.headers.get("x-data-source"), "memory-cache");
    assert.equal(deps.calls.fetchNews, 1);
    assert.equal(deps.calls.scoreMoods, 1);
  });
});

test("GET /news falls back to stored articles when an upstream API fails", async () => {
  fs.writeFileSync(process.env.DATA_FILE, JSON.stringify([{ id: 0, title: "old", mood: 5 }]));
  const deps = fakeDeps({ scoreMoods: async () => { throw new news.UpstreamError("gemini", 404); } });
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/news`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-data-source"), "stored");
    assert.equal((await res.json())[0].title, "old");
  });
});

test("GET /news returns 502 without leaking details when nothing is stored", async () => {
  const deps = fakeDeps({ fetchNews: async () => { throw new news.UpstreamError("mediastack", 429, "usage_limit_reached"); } });
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/news`);
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.ok(!text.includes("usage_limit"));
  });
});

test("POST /rewrite validates input and rewrites a stored article", async () => {
  fs.writeFileSync(process.env.DATA_FILE, JSON.stringify([{ id: 0, title: "T", description: "D", mood: 5 }]));
  const deps = fakeDeps();
  await withServer(deps, async (base) => {
    const post = (body) => fetch(`${base}/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ id: 0, mood: 11 })).status, 400);
    assert.equal((await post({ id: 9, mood: 3 })).status, 404);
    const res = await post({ id: 0, mood: 3 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { title: "T!", description: "D", mood: 3 });
  });
});

test("POST /rewrite is rate limited per client", async () => {
  fs.writeFileSync(process.env.DATA_FILE, JSON.stringify([{ id: 0, title: "T", description: "D", mood: 5 }]));
  const deps = fakeDeps();
  await withServer(deps, async (base) => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const r = await fetch(`${base}/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: 0, mood: 2 }) });
      statuses.push(r.status);
    }
    assert.equal(statuses.filter((s) => s === 200).length, 10);
    assert.equal(statuses.at(-1), 429);
  });
});

test("Gemini client sends the key in a header, not the URL, and parses fenced JSON", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "```json\n[1, 9]\n```" }] } }] }) };
  };
  const scores = await news.scoreMoods(["a", "b"], { fetchImpl });
  assert.deepEqual(scores, [1, 9]);
  assert.ok(!seen.url.includes("test-key"));
  assert.equal(seen.init.headers["x-goog-api-key"], "test-key");
});

test("MediaStack client surfaces quota errors as UpstreamError", async () => {
  process.env.MEDIASTACK_ACCESS_KEY = "k";
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: { code: "usage_limit_reached" } }) });
  await assert.rejects(news.fetchNews({ fetchImpl }), (e) => e.name === "UpstreamError" && e.status === 429);
});
