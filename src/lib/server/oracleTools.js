/*
  Realtime tools for The Oracle. The model can call these mid-question:

  - sleeper_get: live reads from Sleeper's API for the CURRENT league only,
    against a strict path whitelist (no arbitrary URLs - SSRF-proof), with
    responses slimmed server-side so a matchup week can't blow up the
    context window.
  - franchise_game_log: every regular-season + playoff score a franchise
    has ever posted, served from the baked rivalry archive (one edge-cached
    file beats ~150 Sleeper calls). This is how "what's my best game ever"
    gets answered.

  Used by /api/ask's tool loop.
*/

const LIVE_TIMEOUT_MS = 3000;

const timed = (p) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), LIVE_TIMEOUT_MS))]);

export const toolDefinitions = (leagueID) => [
  {
    name: 'sleeper_get',
    description:
      `Live read from the Sleeper fantasy API for this league (id ${leagueID}). ` +
      'Allowed paths: /v1/state/nfl, /v1/league/{id}/rosters, /v1/league/{id}/users, ' +
      '/v1/league/{id}/matchups/{week}, /v1/league/{id}/transactions/{week}, ' +
      '/v1/league/{id}/traded_picks, /v1/league/{id}/winners_bracket, /v1/league/{id}/drafts, ' +
      '/v1/draft/{draft_id} and /v1/draft/{draft_id}/picks (the pick-by-pick draft BOARD - works for ' +
      'any season in this league\'s history: get draft ids from /v1/league/{league_id}/drafts using the ' +
      'league ids in leagueChain, then fetch the picks to see exactly who was selected at each slot). ' +
      'Use for CURRENT-season live state or historical draft boards not already in the provided league data.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'e.g. /v1/league/' + leagueID + '/matchups/3' } },
      required: ['path'],
    },
  },
  {
    name: 'player_values',
    description:
      'CURRENT dynasty market values (FantasyCalc, superflex 12-team 0.5PPR - this league\'s format) for ' +
      'players AND rookie picks (e.g. "2026 1st"), with 30-day trend. Use to evaluate trade fairness, ' +
      'roster strength, or "what is X worth". Pass names to look up, or a rosterID for a whole-team valuation.',
    input_schema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Player or pick names to value' },
        rosterID: { type: 'integer', description: 'Value an entire franchise roster' },
      },
    },
  },
  {
    name: 'matchup_detail',
    description:
      'The complete box score of any game in league history: every rostered player\'s points that week, ' +
      'starters marked, optimal lineup and points left on the bench. Use for questions about specific ' +
      'weeks, bench points, or start/sit decisions.',
    input_schema: {
      type: 'object',
      properties: {
        season: { type: 'integer', description: 'e.g. 2023' },
        week: { type: 'integer' },
        rosterID: { type: 'integer' },
      },
      required: ['season', 'week', 'rosterID'],
    },
  },
  {
    name: 'trade_history',
    description:
      'Every trade in league history (and this season live): who traded with whom, exactly which ' +
      'players and picks moved each way, season and week. Filter by team rosterID, player name, or season. ' +
      'Use for any question about past trades.',
    input_schema: {
      type: 'object',
      properties: {
        rosterID: { type: 'integer', description: 'Optional: only trades involving this franchise' },
        playerName: { type: 'string', description: 'Optional: only trades involving this player' },
        season: { type: 'integer', description: 'Optional: only this season (e.g. 2023)' },
      },
    },
  },
  {
    name: 'player_league_history',
    description:
      "A player's complete history IN THIS LEAGUE: when he was drafted and by whom, every game he was " +
      'started (year, week, points scored, which team started him, opponent), career totals and best game. ' +
      'Use for any question about how a player has performed in this league.',
    input_schema: {
      type: 'object',
      properties: { playerName: { type: 'string', description: "Player's name, e.g. 'Travis Etienne'" } },
      required: ['playerName'],
    },
  },
  {
    name: 'site_file',
    description:
      "The site's current analysis files: 'power_rankings' (this week's ranks, records, roster values, AI blurbs), " +
      "'playoff_odds' (simulated playoff/title/top-pick odds per team), 'record_watch' (all-time top-5 lists: " +
      "highs, blowouts, closest games), 'tradeblock' (players/picks currently on the block with interest counts).",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', enum: ['power_rankings', 'playoff_odds', 'record_watch', 'tradeblock'] } },
      required: ['name'],
    },
  },
  {
    name: 'franchise_game_log',
    description:
      'Complete historical game log for one franchise: every weekly score ever posted (all seasons, ' +
      'regular season and playoffs), with opponent and result. Use for questions about a specific ' +
      "team's best/worst games, streaks, season arcs, or head-to-head history beyond the summaries provided. " +
      'rosterID is in the rosters section of the league data.',
    input_schema: {
      type: 'object',
      properties: { rosterID: { type: 'integer', description: 'The franchise roster ID (1-12)' } },
      required: ['rosterID'],
    },
  },
];

const pathAllowed = (path, leagueID) => {
  const patterns = [
    /^\/v1\/state\/nfl$/,
    new RegExp(`^/v1/league/${leagueID}/(rosters|users|traded_picks|winners_bracket|losers_bracket|drafts)$`),
    // any league in this league's own history may serve its drafts listing
    /^\/v1\/league\/\d+\/drafts$/,
    // the league's own draft board (detail + picks); ownership verified after fetch
    /^\/v1\/draft\/\d+(\/picks)?$/,
    new RegExp(`^/v1/league/${leagueID}/(matchups|transactions)/(1[0-8]|[1-9])$`),
  ];
  return patterns.some((re) => re.test(path));
};

// keep tool results small: strip the per-player scoring maps that make
// raw Sleeper payloads huge
const slim = (path, data) => {
  if (/\/matchups\/\d+$/.test(path) && Array.isArray(data)) {
    return data.map((m) => ({ roster_id: m.roster_id, matchup_id: m.matchup_id, points: m.points }));
  }
  if (/\/rosters$/.test(path) && Array.isArray(data)) {
    return data.map((r) => ({
      roster_id: r.roster_id, owner_id: r.owner_id,
      wins: r.settings?.wins, losses: r.settings?.losses, fpts: r.settings?.fpts,
      players: r.players, starters: r.starters, taxi: r.taxi, reserve: r.reserve,
    }));
  }
  if (/\/users$/.test(path) && Array.isArray(data)) {
    return data.map((u) => ({ user_id: u.user_id, display_name: u.display_name, team_name: u.metadata?.team_name?.trim() }));
  }
  return data;
};

export async function runTool({ name, input, leagueID, knowledge, fetchFn }) {
  if (name === 'sleeper_get') {
    const path = String(input?.path || '');
    if (!pathAllowed(path, leagueID)) {
      return { error: `path not allowed: ${path}. Stick to the documented allowed paths for league ${leagueID}.` };
    }
    // draft endpoints must belong to THIS league (picks payloads carry no league id)
    if (/^\/v1\/league\/\d+\/drafts$/.test(path)) {
      const lidInPath = path.match(/league\/(\d+)/)[1];
      const chain = knowledge?.leagueChain || [leagueID];
      if (!chain.includes(lidInPath)) return { error: 'that league is not part of this league\'s history' };
    }
    if (path.startsWith('/v1/draft/')) {
      const did = path.match(/^\/v1\/draft\/(\d+)/)[1];
      const dRes = await timed(fetch('https://api.sleeper.app/v1/draft/' + did));
      if (!dRes.ok) return { error: 'draft unavailable' };
      const dMeta = await dRes.json();
      const chain = knowledge?.leagueChain || [leagueID];
      if (!chain.includes(dMeta?.league_id)) return { error: 'that draft is not part of this league' };
    }
    const res = await timed(fetch('https://api.sleeper.app' + path));
    if (!res.ok) return { error: `Sleeper returned ${res.status}` };
    const data = slim(path, await res.json());
    const text = JSON.stringify(data);
    if (text.length > 12000) return { note: 'response truncated to fit', preview: text.slice(0, 12000) };
    return data;
  }

  if (name === 'franchise_game_log') {
    const rosterID = parseInt(input?.rosterID, 10);
    if (!(rosterID >= 1 && rosterID <= 32)) return { error: 'invalid rosterID' };
    const res = await timed(fetchFn('/data/rivalry-matchups.json'));
    if (!res.ok) return { error: 'history archive unavailable' };
    const rivalry = await res.json();
    const names = knowledge.rosterNames || {};
    const log = [];
    for (const s of Object.values(rivalry.seasons || {})) {
      const year = parseInt(s.year, 10);
      const collect = (week, game, playoff) => {
        if (!Array.isArray(game) || game.length !== 2) return;
        const [a, b] = game;
        const me = a.roster_id === rosterID ? a : b.roster_id === rosterID ? b : null;
        if (!me) return;
        const opp = me === a ? b : a;
        const myPts = me.points.reduce((x, y) => x + y, 0);
        const oppPts = opp.points.reduce((x, y) => x + y, 0);
        if (myPts === 0 && oppPts === 0) return; // never played (2018 partial)
        log.push({
          year, week, playoff: playoff || undefined,
          pts: Math.round(myPts * 100) / 100,
          opp: names[opp.roster_id] || `Team ${opp.roster_id}`,
          oppPts: Math.round(oppPts * 100) / 100,
          result: myPts > oppPts ? 'W' : myPts < oppPts ? 'L' : 'T',
        });
      };
      (s.weeks || []).forEach((week, ix) => {
        if (week) Object.values(week).forEach((g) => collect(ix + 1, g, false));
      });
      Object.entries(s.playoffWeeks || {}).forEach(([wk, games]) => {
        Object.values(games || {}).forEach((g) => collect(parseInt(wk, 10), g, true));
      });
    }
    log.sort((a, b) => a.year - b.year || a.week - b.week);
    return { franchise: names[rosterID] || `Team ${rosterID}`, games: log };
  }

  if (name === 'player_values') {
    if (!globalThis.__fcCache || Date.now() - globalThis.__fcCache.at > 3600e3) {
      const res = await timed(fetch('https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5'), 4000);
      if (!res.ok) return { error: 'values feed unavailable right now' };
      globalThis.__fcCache = { at: Date.now(), data: await res.json() };
    }
    const feed = globalThis.__fcCache.data;
    const fmt = (e) => ({ name: e.player.name, value: e.value, trend30Day: e.trend30Day, overallRank: e.overallRank });
    if (input?.rosterID) {
      const liteRes = await timed(fetchFn('/data/players-lite.json'));
      const lite = liteRes.ok ? await liteRes.json() : {};
      const rosterRes = await timed(fetch(`https://api.sleeper.app/v1/league/${leagueID}/rosters`));
      if (!rosterRes.ok) return { error: 'rosters unavailable' };
      const roster = (await rosterRes.json()).find((r) => r.roster_id === parseInt(input.rosterID, 10));
      if (!roster) return { error: 'no such roster' };
      const bySleeper = Object.fromEntries(feed.filter((e) => e.player.sleeperId).map((e) => [e.player.sleeperId, e]));
      const valued = (roster.players || []).map((id) => {
        const e = bySleeper[id];
        return { name: (lite[id] || `Player ${id}|`).split('|')[0], value: e?.value ?? 0 };
      }).sort((a, b) => b.value - a.value);
      return {
        rosterID: roster.roster_id,
        totalValue: valued.reduce((a, b) => a + b.value, 0),
        top10: valued.slice(0, 10),
        note: 'values are market consensus, not gospel',
      };
    }
    const names = (input?.names || []).map((n) => String(n).toLowerCase().trim()).filter(Boolean);
    if (!names.length) return { error: 'give names or a rosterID' };
    const out = {};
    for (const q of names.slice(0, 12)) {
      const hits = feed.filter((e) => e.player.name.toLowerCase().includes(q)).slice(0, 3).map(fmt);
      out[q] = hits.length ? hits : 'not in the values feed (worth ~0 on the market, or check spelling)';
    }
    return out;
  }

  if (name === 'matchup_detail') {
    const [maRes, liteRes] = await Promise.all([
      timed(fetchFn('/data/matchups-archive.json')),
      timed(fetchFn('/data/players-lite.json')),
    ]);
    if (!maRes.ok || !liteRes.ok) return { error: 'matchups archive unavailable' };
    const [ma, lite] = await Promise.all([maRes.json(), liteRes.json()]);
    const season = ma.seasons?.[String(input.season)];
    if (!season) return { error: `no archived season ${input.season}` };
    const wk = season.weeks?.[parseInt(input.week, 10) - 1];
    if (!wk || !wk.length) return { error: `no games archived for ${input.season} week ${input.week}` };
    const t = wk.find((x) => x.r === parseInt(input.rosterID, 10));
    if (!t) return { error: 'that roster has no game that week' };
    const opp = wk.find((x) => x.m != null && x.m === t.m && x.r !== t.r);
    const nm = (id) => (lite[id] || `Player ${id}|?`).split('|')[0];
    const started = new Set(t.starters || []);
    const box = Object.entries(t.pp || {})
      .map(([id, pts]) => ({ player: nm(id), pts, started: started.has(id) }))
      .sort((a, b) => b.pts - a.pts);
    return {
      season: input.season, week: input.week,
      team: (knowledge.rosterNames || {})[t.r] || `Team ${t.r}`,
      scored: t.pts,
      opponent: opp ? { team: (knowledge.rosterNames || {})[opp.r] || `Team ${opp.r}`, scored: opp.pts } : 'no head-to-head pairing archived',
      boxScore: box,
    };
  }

  if (name === 'trade_history') {
    const [archiveRes, liteRes] = await Promise.all([
      timed(fetchFn('/data/transactions-archive.json')),
      timed(fetchFn('/data/players-lite.json')),
    ]);
    if (!archiveRes.ok || !liteRes.ok) return { error: 'archive unavailable' };
    const [archive, lite] = await Promise.all([archiveRes.json(), liteRes.json()]);
    const names = knowledge.rosterNames || {};
    const pName = (id) => (lite[id] || `Player ${id}|`).split('|')[0];
    const yearByLid = {};
    // completed seasons from the archive, current season live
    const txSets = [];
    for (const [lid, txs] of Object.entries(archive.seasons || {})) txSets.push({ lid, txs });
    try {
      const liveWeeks = await Promise.all([1, 2, 3].map((w) =>
        timed(fetch(`https://api.sleeper.app/v1/league/${leagueID}/transactions/${w}`)).then((r) => (r.ok ? r.json() : []))));
      txSets.push({ lid: leagueID, txs: liveWeeks.flat(), live: true });
    } catch { /* live unavailable - archive still answers */ }

    const seasonYear = (tx, set) => {
      if (set.live) return knowledge.nflState?.season ? parseInt(knowledge.nflState.season, 10) : new Date().getFullYear();
      return new Date(tx.status_updated || tx.created || 0).getFullYear();
    };

    const wanted = [];
    const filterName = (input?.playerName || '').toLowerCase().trim();
    for (const set of txSets) {
      for (const tx of set.txs || []) {
        if (tx.type !== 'trade' || tx.status !== 'complete') continue;
        const year = seasonYear(tx, set);
        if (input?.season && year !== parseInt(input.season, 10)) continue;
        if (input?.rosterID && !(tx.roster_ids || []).includes(parseInt(input.rosterID, 10))) continue;
        const sides = {};
        for (const rid of tx.roster_ids || []) sides[rid] = [];
        for (const [pid, toRoster] of Object.entries(tx.adds || {})) {
          const giver = Object.entries(tx.drops || {}).find(([p]) => p === pid)?.[1];
          if (giver != null && sides[giver]) sides[giver].push(pName(pid));
        }
        for (const pk of tx.draft_picks || []) {
          if (sides[pk.previous_owner_id]) {
            sides[pk.previous_owner_id].push(`${pk.season} R${pk.round} pick${pk.roster_id !== pk.previous_owner_id ? ` (orig ${names[pk.roster_id] || 'Team ' + pk.roster_id})` : ''}`);
          }
        }
        const allAssets = Object.values(sides).flat().join(' ').toLowerCase();
        if (filterName && !allAssets.includes(filterName)) continue;
        wanted.push({
          season: year, week: tx.leg,
          trade: Object.entries(sides).map(([rid, gave]) => `${names[rid] || 'Team ' + rid} gave: ${gave.join(', ') || 'nothing?'}`).join(' | '),
        });
      }
    }
    wanted.sort((a, b) => b.season - a.season || (b.week || 0) - (a.week || 0));
    const capped = wanted.slice(0, 30);
    return { totalMatches: wanted.length, showing: capped.length, trades: capped };
  }

  if (name === 'player_league_history') {
    const [rivalryRes, liteRes] = await Promise.all([
      timed(fetchFn('/data/rivalry-matchups.json')),
      timed(fetchFn('/data/players-lite.json')),
    ]);
    if (!rivalryRes.ok || !liteRes.ok) return { error: 'history unavailable' };
    const [rivalry, lite] = await Promise.all([rivalryRes.json(), liteRes.json()]);
    const q = String(input?.playerName || '').toLowerCase().trim();
    if (q.length < 3) return { error: 'give at least part of a player name' };
    const matches = Object.entries(lite).filter(([, v]) => v.split('|')[0].toLowerCase().includes(q));
    if (!matches.length) return { error: `no player matching "${input.playerName}" has appeared in this league` };
    if (matches.length > 4) return { ambiguous: matches.slice(0, 8).map(([, v]) => v.split('|')[0]), note: 'be more specific' };
    const names = knowledge.rosterNames || {};
    const out = [];
    for (const [pid, v] of matches) {
      const [nm, pos] = v.split('|');
      const starts = [];
      for (const s of Object.values(rivalry.seasons || {})) {
        const year = parseInt(s.year, 10);
        (s.weeks || []).forEach((week, ix) => {
          if (!week) return;
          for (const game of Object.values(week)) {
            if (!Array.isArray(game) || game.length !== 2) continue;
            for (const t of game) {
              const si = (t.starters || []).indexOf(pid);
              if (si === -1) continue;
              const pts = t.points?.[si];
              const opp = game.find((x) => x !== t);
              starts.push({ year, week: ix + 1, pts, startedBy: names[t.roster_id] || 'Team ' + t.roster_id, opp: names[opp?.roster_id] || '?' });
            }
          }
        });
      }
      const drafted = knowledge.draftedBy?.[pid];
      const scored = starts.filter((x) => typeof x.pts === 'number');
      const best = scored.length ? scored.reduce((a, b) => (b.pts > a.pts ? b : a)) : null;
      out.push({
        player: `${nm} (${pos})`,
        drafted: drafted ? `drafted ${drafted}` : 'never drafted here (free-agent pickup if rostered)',
        timesStarted: starts.length,
        avgWhenStarted: scored.length ? Math.round((scored.reduce((a, b) => a + b.pts, 0) / scored.length) * 100) / 100 : null,
        bestGame: best ? `${best.pts} pts (${best.year} Wk ${best.week}, started by ${best.startedBy})` : null,
        recentStarts: starts.slice(-10),
      });
    }
    return out.length === 1 ? out[0] : out;
  }

  if (name === 'site_file') {
    const files = {
      power_rankings: '/data/power-rankings.json',
      playoff_odds: '/data/playoff-odds.json',
      record_watch: '/data/record-watch.json',
      tradeblock: '/data/tradeblock.json',
    };
    const path = files[input?.name];
    if (!path) return { error: 'unknown file' };
    const res = await timed(fetchFn(path));
    if (!res.ok) return { error: 'file unavailable' };
    let data = await res.json();
    // slim the heavy bits that don't help answers
    if (input.name === 'power_rankings' && data.teams) {
      data = { ...data, teams: data.teams.map(({ valueHistory, ...t }) => t) };
    }
    const text = JSON.stringify(data);
    if (text.length > 14000) return { note: 'truncated', preview: text.slice(0, 14000) };
    return data;
  }

  return { error: `unknown tool ${name}` };
}
