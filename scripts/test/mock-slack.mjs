// Preloaded into `vite preview` by webhook.e2e.mjs (NODE_OPTIONS=--import).
// Replaces global fetch for slack.com only: channel history comes from the
// state file the test writes, every Slack call is appended to the log file,
// and everything else (Sleeper) goes out for real. Test-only - never shipped
// to Vercel, never loaded by the site.
import { readFileSync, appendFileSync } from "node:fs";

const STATE = process.env.PARLAY_MOCK_STATE, LOG = process.env.PARLAY_MOCK_LOG;
const real = globalThis.fetch;
const ok = (d) => new Response(JSON.stringify({ ok: true, ...d }), { headers: { "content-type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!/^https:\/\/slack\.com\/api\//.test(url)) return real(input, init);
  const u = new URL(url);
  const method = u.pathname.replace("/api/", "");
  const params = Object.fromEntries(u.searchParams);
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* form bodies aren't used */ }
  appendFileSync(LOG, JSON.stringify({ method, params, body }) + "\n");
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  switch (method) {
    case "conversations.history": return ok({ messages: s.messages || [], has_more: false, response_metadata: {} });
    case "conversations.replies": return ok({ messages: [{ ts: params.ts }, ...(s.replies || []).filter((r) => !r.thread_ts || r.thread_ts === params.ts)], has_more: false });
    case "chat.getPermalink": return ok({ permalink: "https://slack.test/p/board" });
    case "bookmarks.list": return ok({ bookmarks: [{ id: "Bk1", title: ":clipboard: Week 3 board" }] });
    case "chat.postMessage": return ok({ ts: `${Date.now() / 1000}`, channel: body.channel });
    default: return ok({});
  }
};
