// Generates static/data/draft-recap.json for the CURRENT season's
// completed rookie draft: a tongue-in-cheek, roast-style blurb per pick,
// informed by franchise history from knowledge.json. Skips work when the
// current season's recap already exists with a matching pick count, so
// the hand-written 2026 edition (and any edited edition) is never
// clobbered. Requires ANTHROPIC_API_KEY; exits quietly without one.
import fs from "node:fs";

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
const OUT = "static/data/draft-recap.json";

const knowledge = JSON.parse(fs.readFileSync("static/data/knowledge.json", "utf8"));
const leagueID = knowledge.leagueID;

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
};

const drafts = await get(`https://api.sleeper.app/v1/league/${leagueID}/drafts`);
const draft = drafts?.[0];
if (!draft || draft.status !== "complete") {
  console.log("draft not complete - no recap to build");
  process.exit(0);
}
const picks = await get(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`);
if (!picks.length) { console.log("no picks"); process.exit(0); }

const season = String(draft.season || knowledge.nflState?.season || new Date().getFullYear());
if (fs.existsSync(OUT)) {
  try {
    const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const count = Object.values(existing.rounds || {}).reduce((n, r) => n + r.length, 0);
    if (existing.season === season && count >= picks.length) {
      console.log(`recap for ${season} already exists (${count} blurbs) - skipping`);
      process.exit(0);
    }
  } catch { /* rebuild on parse failure */ }
}
if (!KEY) { console.log("no ANTHROPIC_API_KEY - skipping recap generation"); process.exit(0); }

// per-franchise roast fuel
const fuel = {};
for (const f of knowledge.franchises || []) {
  const latest = (knowledge.seasons || []).slice().sort((a, b) => b.year - a.year)
    .flatMap((s) => s.standings.filter((row) => row.rosterID === f.rosterID).map((row) => `${s.year}: ${row.w}-${row.l}, ${row.pf} pf`))
    .slice(0, 2);
  fuel[f.rosterID] = `${(f.name || "").trim()} (${(knowledge.ownersByRoster?.[f.rosterID] || "").split(" (")[0]}): titles ${f.titles || 0}; recent ${latest.join("; ")}`;
}
const board = picks.map((p) => `${p.round}.${String(p.draft_slot).padStart(2, "0")} ${p.metadata?.first_name} ${p.metadata?.last_name} (${p.metadata?.position}, ${p.metadata?.team || "FA"}) -> roster ${p.roster_id}`).join("\n");

const prompt = `You are writing the annual draft-recap roast for a 12-team superflex dynasty fantasy football league ("ACT, or DIE."). Write a witty, tongue-in-cheek, roast-style blurb (1-2 sentences) for EVERY pick below - crass is welcome, mild curse words allowed when they earn their place, but punch at fantasy decisions and franchise history, never at anyone's real life. Use the franchise context for callbacks (records, titles, droughts, the Toilet Bowl losers bracket). Also write a 2-3 sentence intro and 4-6 fun awards.

FRANCHISE CONTEXT:
${Object.values(fuel).join("\n")}

THE BOARD (pick player (pos, NFL team) -> drafting roster id):
${board}

Respond ONLY with JSON matching exactly this shape (rounds keyed by round number as strings; include every pick):
{"season":"${season}","generated":"<today>","title":"...","intro":"...","rounds":{"1":[{"pick":"1.01","player":"...","pos":"...","team":"<franchise name>","manager":"<first name>","blurb":"..."}]},"awards":[{"award":"...","winner":"...","why":"..."}]}`;

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) { console.error("anthropic error", res.status); process.exit(0); }
const data = await res.json();
const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim()
  .replace(/^```json\s*/i, "").replace(/```\s*$/, "");
let recap;
try { recap = JSON.parse(text); } catch { console.error("recap JSON parse failed"); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(recap, null, 1));
const total = Object.values(recap.rounds || {}).reduce((n, r) => n + r.length, 0);
console.log(`wrote ${OUT} (${season}: ${total} blurbs)`);
