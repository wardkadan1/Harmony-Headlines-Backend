# Harmony Headlines Backend

The Express API behind [Harmony Headlines](https://github.com/wardkadan1/Harmony-Headlines). It fetches conflict news from MediaStack, scores each headline's mood with Google Gemini and rewrites articles to a chosen tone. The API keys stay on the server.

## Overview

- **News pipeline.** `GET /news` fetches up to 10 English `israel,palestine` articles, gets a 0-10 mood score per headline from Gemini (0 = most friendly, 10 = most aggressive), stores them in `data.json` and returns them.
- **Tone rewriting.** `POST /rewrite` rewrites a stored article to a 1-10 mood and keeps the facts.
- **Stack.** Node.js, Express 4, `cors`, native `fetch` (no SDKs) and `node:test`.

## API Reference

| Method | Path | Body / Params | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/` | none | `200` text `Hello from the backend!` | none |
| `GET` | `/news` | none | `200` scored articles; `X-Data-Source`: `live`, `memory-cache` or `stored` | `502` |
| `POST` | `/rewrite` | `{ "id": number, "mood": 1-10 }` | `200` `{ title, description, mood }` | `400`, `404`, `429`, `502` |
| `GET` | `/data` | none | `200` all stored articles | none |
| `GET` | `/data/:id` | `id`: numeric article ID | `200` one stored article | `404` |
| `POST` | `/initial-mood` | `{ "allData": Article[] }` | `200`, replaces `data.json` | `400` |

`/initial-mood` is a legacy route, kept for older frontend builds. Article shape: `{ id, title, image, author, published_at, description, mood }`.

## Configuration

Copy `.env.example` to `.env`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MEDIASTACK_ACCESS_KEY` | Yes | none | MediaStack access key |
| `GEMINI_API_KEY` | Yes | none | Google Gemini API key |
| `GEMINI_MODEL` | No | `gemini-3.5-flash-lite` | Model for scoring and rewriting |
| `NEWS_CACHE_MINUTES` | No | `30` | `/news` cache lifetime |
| `REWRITE_LIMIT_PER_MINUTE` | No | `10` | `/rewrite` requests per IP per minute |
| `PORT` | No | `3000` | HTTP port |

The server warns at startup if a required key is missing.

## Engineering Decisions

- **In-memory cache.** `/news` is cached for `NEWS_CACHE_MINUTES`, so page reloads don't spend free-tier API quota.
- **Stored-article fallback.** If MediaStack or Gemini fails (quota, retired model, outage), `/news` serves the last stored articles. It returns a generic `502`, with no upstream details, only when nothing is stored.
- **Rate limit.** Every `/rewrite` call costs a Gemini request, so the route has a per-IP fixed-window limiter.
- **Key in a header.** The Gemini key goes in the `x-goog-api-key` header, not the URL, so it stays out of URL logs.
- **Injectable dependencies.** `createApp(deps)` lets the tests swap in fake upstream APIs.
- **Defensive parsing.** Code-fenced Gemini output is cleaned, and its shape is checked before use.

## Testing

```bash
npm test
```

8 tests in `test/server.test.js` pass with no keys or network access. They cover `/news` shape, caching, fallback and the no-leak `502`, `/rewrite` validation and rate limiting, the Gemini header key and fence parsing, and MediaStack quota errors. Line coverage is about 81% for both `server.js` and `lib/news.js` (`node --test --experimental-test-coverage`). The Gemini rewrite client and the legacy routes aren't covered.

## Getting Started

`npm start` runs on Node.js 18+. `npm run dev` (uses `--env-file-if-exists`) and `npm test` (uses a test glob) need Node.js 22+.

```bash
git clone https://github.com/wardkadan1/Harmony-Headlines-Backend.git
cd Harmony-Headlines-Backend
npm install
cp .env.example .env   # add your keys
npm run dev            # watch mode, loads .env
```

`npm start` runs `node server.js` without loading `.env`. Use it on hosts that inject env vars, such as Render.

## Limitations

- **No server-side auth.** `/rewrite` and `/initial-mood` don't verify a Clerk session. The admin-only slider is enforced in the frontend only.
- **JSON-file storage.** `data.json` is written synchronously and is lost on hosts with ephemeral disks. The committed sample has no `id` fields, so `/data/:id` and the fallback have nothing to serve until `/news` succeeds once.
- **Per-process state.** The cache and limiter live in memory. `trust proxy` isn't set, so clients behind a reverse proxy may share one rate-limit bucket.
- **Open CORS** for all origins.
- **Rewrites aren't saved**, only returned.

## Related Repository

- **Frontend:** [Harmony-Headlines](https://github.com/wardkadan1/Harmony-Headlines). A React + Vite app with Clerk authentication that calls this API.

## Author

**Ward Keadan**

- GitHub: [@wardkadan1](https://github.com/wardkadan1)
- Portfolio: [wardkeadan.vercel.app](https://wardkeadan.vercel.app)
