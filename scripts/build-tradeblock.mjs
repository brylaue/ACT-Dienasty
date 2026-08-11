/*
  Auto-syncs the Trade Block from Sleeper itself - no more manual config.

  Managers flag players (and draft picks) on their trade block in the
  Sleeper app; that state isn't in Sleeper's documented REST API, but it
  IS readable from their public GraphQL endpoint: each league player's
  settings carry `otb` (the roster_id that put it On The Block) plus
  `otb_added_at`, and metadata carries `likes` (trade-interest hearts).

  Output: static/data/tradeblock.json, grouped by team with display-ready
  names, positions, and avatars. Runs in both the weekly refresh and the
  30-minute poll job, so the page tracks the app closely. On any fetch
  failure the existing file is left untouched (never overwritten with an
  empty block).

  Run manually: node scripts/build-tradeblock.mjs
*/
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const leagueInfo = readFileSync(join(root, "src/lib/utils/leagueInfo.js"), "utf8");
const leagueID = leagueInfo.match(/leagueID\s*=\s*"(\d+)"/)?.[1];
if (!leagueID) throw new Error("Could not find leagueID in leagueInfo.js");

const get = async (url, retries = 4) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (attempt >= retries) throw new Error(`${res.status} for ${url}`);
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
};

// --- 1. the block itself, from Sleeper's GraphQL ---
const gqlRes = await fetch("https://sleeper.com/graphql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `{ league_players(league_id: "${leagueID}") { player_id metadata settings } }`,
  }),
});
if (!gqlRes.ok) throw new Error(`GraphQL ${gqlRes.status}`);
const gql = await gqlRes.json();
const leaguePlayers = gql?.data?.league_players;
if (!Array.isArray(leaguePlayers)) throw new Error("GraphQL response missing league_players");

const onBlock = leaguePlayers.filter((p) => p.settings?.otb != null);

// --- 2. team names + avatars ---
const [rosters, users] = await Promise.all([
  get(`https://api.sleeper.app/v1/league/${leagueID}/rosters`),
  get(`https://api.sleeper.app/v1/league/${leagueID}/users`),
]);
const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
const rosterById = Object.fromEntries(rosters.map((r) => [r.roster_id, r]));
const teamNameFor = (rosterID) => {
  const u = userById[rosterById[rosterID]?.owner_id];
  return u?.metadata?.team_name || u?.display_name || `Team ${rosterID}`;
};
const avatarFor = (rosterID) => {
  const u = userById[rosterById[rosterID]?.owner_id];
  if (u?.metadata?.avatar) return u.metadata.avatar; // custom uploaded avatar (full URL)
  if (u?.avatar) return `https://sleepercdn.com/avatars/thumbs/${u.avatar}`;
  return null;
};

// --- 3. player names, only for the ids we actually need ---
// (players/nfl is a big blob, but this runs on a GitHub runner, not in
// anyone's browser, and only flagged ids are kept)
const neededPlayerIds = onBlock
  .map((p) => p.player_id)
  .filter((id) => !id.includes(",")); // "roster,season,round" ids are picks
let playerNames = {};
if (neededPlayerIds.length) {
  const allPlayers = await get("https://api.sleeper.app/v1/players/nfl");
  for (const id of neededPlayerIds) {
    const pl = allPlayers[id];
    if (pl) {
      playerNames[id] = {
        name: `${pl.first_name} ${pl.last_name}`,
        position: pl.position || null,
        team: pl.team || null,
      };
    }
  }
}

const ordinal = (n) => n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

// --- 4. group by flagging roster, newest first within each team ---
const byRoster = {};
for (const p of onBlock) {
  const rosterID = p.settings.otb;
  const likes = parseInt(p.metadata?.likes || "0", 10) || 0;
  const addedAt = p.settings.otb_added_at || 0;

  let item;
  if (p.player_id.includes(",")) {
    const [origRoster, season, round] = p.player_id.split(",");
    item = {
      type: "pick",
      label: `${season} ${ordinal(parseInt(round, 10))} Round Pick`,
      detail: parseInt(origRoster, 10) !== rosterID ? `orig. ${teamNameFor(parseInt(origRoster, 10))}` : null,
      likes,
      addedAt,
    };
  } else {
    const info = playerNames[p.player_id];
    item = {
      type: "player",
      label: info?.name || `Player ${p.player_id}`,
      position: info?.position || null,
      detail: info ? [info.position, info.team].filter(Boolean).join(" · ") : null,
      likes,
      addedAt,
    };
  }
  (byRoster[rosterID] ||= []).push(item);
}

const teams = Object.keys(byRoster)
  .map((rid) => ({
    rosterID: parseInt(rid, 10),
    teamName: teamNameFor(parseInt(rid, 10)),
    avatar: avatarFor(parseInt(rid, 10)),
    items: byRoster[rid].sort((a, b) => b.addedAt - a.addedAt),
  }))
  .sort((a, b) => b.items.length - a.items.length);

mkdirSync(join(root, "static/data"), { recursive: true });
writeFileSync(
  join(root, "static/data/tradeblock.json"),
  JSON.stringify({ generated: new Date().toISOString(), teams }),
);
console.log(
  `wrote static/data/tradeblock.json (${teams.length} teams, ${onBlock.length} items on the block)`,
);
