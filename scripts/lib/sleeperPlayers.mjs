/*
  Sleeper's full player database (several MB) is needed by four bake
  scripts. Sleeper asks apps to pull it at most once a day; each bake used
  to pull it four times. The first script in a run fetches it with its own
  retrying get(); the rest reuse the copy in the runner's temp directory,
  which the workflow never commits (it only commits static/data). The copy
  goes stale after 6 hours so a long-lived dev machine re-fetches.
  Failure behaviour is the caller's: get() throws exactly as before.
*/
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CACHE = join(tmpdir(), "act-dienasty-sleeper-players.json");
const MAX_AGE_MS = 6 * 3600e3;
const looksComplete = (p) => p && typeof p === "object" && Object.keys(p).length > 1000;

export const sleeperPlayers = async (get) => {
  try {
    if (existsSync(CACHE) && Date.now() - statSync(CACHE).mtimeMs < MAX_AGE_MS) {
      const cached = JSON.parse(readFileSync(CACHE, "utf8"));
      if (looksComplete(cached)) return cached;
    }
  } catch { /* unreadable copy - fetch fresh */ }
  const players = await get("https://api.sleeper.app/v1/players/nfl");
  try { if (looksComplete(players)) writeFileSync(CACHE, JSON.stringify(players)); } catch { /* best effort */ }
  return players;
};
