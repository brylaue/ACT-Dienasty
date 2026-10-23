// Preloaded into `vite preview` by webhook.e2e.mjs (NODE_OPTIONS=--import).
// Replaces global fetch for the outside world the webhook talks to:
//  - slack.com: channel history comes from the state file the test writes;
//    every call is appended to the log file
//  - ESPN scoreboard: the saved week-7 fixture, kickoffs shifted so the first
//    game starts `firstKickoffInMs` from now (state file), byes kept
//  - ESPN player search: canned answers from state.players ({name: "ABBR"})
// Everything else (Sleeper) goes out for real. Test-only - never shipped to
// Vercel, never loaded by the site.
import { readFileSync, appendFileSync } from "node:fs";

const STATE = process.env.PARLAY_MOCK_STATE, LOG = process.env.PARLAY_MOCK_LOG, SLATE = process.env.PARLAY_MOCK_SLATE;
const real = globalThis.fetch;
const json = (d) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
const ok = (d) => json({ ok: true, ...d });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const s = () => JSON.parse(readFileSync(STATE, "utf8"));
  if (/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard/.test(url)) {
    appendFileSync(LOG, JSON.stringify({ method: "espn.scoreboard", params: {}, body: {} }) + "\n");
    const sb = JSON.parse(readFileSync(SLATE, "utf8"));
    const first = Math.min(...sb.events.map((e) => Date.parse(e.date)));
    const shift = Date.now() + (s().firstKickoffInMs ?? 26 * 3600e3) - first;
    for (const e of sb.events) e.date = new Date(Date.parse(e.date) + shift).toISOString();
    return json(sb);
  }
  if (/^https:\/\/site\.web\.api\.espn\.com\/apis\/common\/v3\/search/.test(url)) {
    const q = decodeURIComponent(new URL(url).searchParams.get("query") || "").toLowerCase();
    const ab = (s().players || {})[q];
    return json({ items: ab ? [{ displayName: q.replace(/\b\w/g, (c) => c.toUpperCase()), league: "nfl", teamRelationships: [{ core: { abbreviation: ab } }] }] : [] });
  }
  if (!/^https:\/\/slack\.com\/api\//.test(url)) return real(input, init);
  const u = new URL(url);
  const method = u.pathname.replace("/api/", "");
  const params = Object.fromEntries(u.searchParams);
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* form bodies aren't used */ }
  appendFileSync(LOG, JSON.stringify({ method, params, body }) + "\n");
  const st = s();
  switch (method) {
    case "conversations.history": return ok({ messages: st.messages || [], has_more: false, response_metadata: {} });
    case "conversations.replies": return ok({ messages: [{ ts: params.ts }, ...(st.replies || []).filter((r) => !r.thread_ts || r.thread_ts === params.ts)], has_more: false });
    case "chat.getPermalink": return ok({ permalink: "https://slack.test/p/board" });
    case "bookmarks.list": return ok({ bookmarks: [{ id: "Bk1", title: ":clipboard: Week 3 board" }] });
    case "chat.postMessage": return ok({ ts: `${Date.now() / 1000}`, channel: body.channel });
    default: return ok({});
  }
};
