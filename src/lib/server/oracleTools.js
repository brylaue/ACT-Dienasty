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
      '/v1/league/{id}/traded_picks, /v1/league/{id}/winners_bracket, /v1/league/{id}/drafts. ' +
      'Use for CURRENT-season live state not already in the provided league data.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'e.g. /v1/league/' + leagueID + '/matchups/3' } },
      required: ['path'],
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

  return { error: `unknown tool ${name}` };
}
