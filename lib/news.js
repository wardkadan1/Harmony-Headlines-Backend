// Server-side integrations for MediaStack (news) and Gemini (mood scoring
// and tone rewriting). API keys are read from the server environment only,
// so they never reach the browser bundle.

const MEDIASTACK_URL =
  process.env.MEDIASTACK_URL || "https://api.mediastack.com/v1/news";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

class UpstreamError extends Error {
  constructor(service, status, message) {
    super(message || `${service} request failed`);
    this.name = "UpstreamError";
    this.service = service;
    this.status = status;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new UpstreamError("config", 500, `${name} is not set`);
  return value;
}

async function fetchNews({ fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    access_key: requireEnv("MEDIASTACK_ACCESS_KEY"),
    languages: "en",
    countries: "us,il,ae",
    keywords: "israel,palestine",
    limit: "10",
  });
  const res = await fetchImpl(`${MEDIASTACK_URL}?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.data)) {
    // MediaStack reports quota/plan problems in body.error
    throw new UpstreamError("mediastack", res.status, body.error?.code);
  }
  return body.data;
}

// Gemini sometimes wraps JSON in ```json fences; strip them before parsing.
function parseModelJson(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

async function generate(prompt, { fetchImpl = fetch } = {}) {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const res = await fetchImpl(
    `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  const body = await res.json().catch(() => ({}));
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!res.ok || typeof text !== "string") {
    throw new UpstreamError("gemini", res.status, body?.error?.status);
  }
  return parseModelJson(text);
}

async function scoreMoods(titles, opts) {
  const prompt = `For each sentence in the following JSON array, give a sentiment
score from 0 to 10, where 0 is the most friendly, supportive and empathetic and
10 is the most aggressive and charged. Return only a JSON array of numbers with
exactly ${titles.length} entries, in the same order. Sentences: ${JSON.stringify(titles)}`;
  const scores = await generate(prompt, opts);
  if (!Array.isArray(scores) || scores.length !== titles.length) {
    throw new UpstreamError("gemini", 502, "unexpected_score_shape");
  }
  return scores.map((s) => Number(s));
}

async function rewriteArticle({ title, description }, mood, opts) {
  const prompt = `I will give you a news title, a description, and a mood number from 1 to 10.
Mood 1 is extremely calm, neutral and reassuring; mood 10 is very intense, alarming or dramatic.
Rewrite the title and description to match the mood while keeping all important facts intact.
Return only a JSON object: {"title": string, "description": string, "mood": number}.
Mood: ${mood}
Title: ${JSON.stringify(title)}
Description: ${JSON.stringify(description || "")}`;
  const out = await generate(prompt, opts);
  if (!out || typeof out.title !== "string") {
    throw new UpstreamError("gemini", 502, "unexpected_rewrite_shape");
  }
  return {
    title: out.title,
    description: typeof out.description === "string" ? out.description : "",
    mood: Number(out.mood ?? mood),
  };
}

// Same article shape the frontend already renders.
function toArticles(rawNews, moods) {
  return rawNews.map((n, index) => ({
    id: index,
    title: n.title,
    image: n.image,
    author: n.author,
    published_at: n.published_at,
    description: n.description,
    mood: moods[index],
  }));
}

module.exports = {
  UpstreamError,
  fetchNews,
  scoreMoods,
  rewriteArticle,
  toArticles,
  parseModelJson,
};
