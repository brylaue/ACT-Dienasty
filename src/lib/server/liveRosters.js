/*
  Live roster layer for The Oracle: rebuilds the rosters section of the
  knowledge pack from Sleeper AT QUESTION TIME, so answers about who owns
  whom, taxi squads, and picks reflect the league as of right now - not
  the last Tuesday bake. Player names come from the baked players-lite
  index; original draft rounds from the baked draftedBy map (those never
  change). Any failure falls back to the baked rosters.
*/

const LIVE_TIMEOUT_MS = 2500;

const timed = (promise) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('live-timeout')), LIVE_TIMEOUT_MS)),
  ]);

export async function buildLiveRosters({ leagueID, knowledge, fetchFn }) {
  const [rostersRes, tradedRes, liteRes] = await Promise.all([
    timed(fetch(`https://api.sleeper.app/v1/league/${leagueID}/rosters`)),
    timed(fetch(`https://api.sleeper.app/v1/league/${leagueID}/traded_picks`)),
    timed(fetchFn('/data/players-lite.json')),
  ]);
  if (!rostersRes.ok || !tradedRes.ok || !liteRes.ok) throw new Error('live fetch failed');
  const [rosters, tradedPicks, lite] = await Promise.all([
    rostersRes.json(), tradedRes.json(), liteRes.json(),
  ]);

  const names = knowledge.rosterNames || {};
  const draftedBy = knowledge.draftedBy || {};
  const nameFor = (rid) => names[rid] || `Team ${rid}`;

  const section = rosters.map((r) => {
    const taxi = new Set(r.taxi || []);
    const ir = new Set(r.reserve || []);
    const players = (r.players || []).map((id) => {
      const [nm, pos] = (lite[id] || `Player ${id}|?`).split('|');
      const drafted = draftedBy[id] ? `drafted ${draftedBy[id]}` : 'undrafted (free-agent pickup)';
      const flags = [taxi.has(id) ? 'ON TAXI SQUAD' : null, ir.has(id) ? 'IR' : null].filter(Boolean);
      return `${nm} (${pos}, ${drafted}${flags.length ? ', ' + flags.join(', ') : ''})`;
    });
    return { rosterID: r.roster_id, name: nameFor(r.roster_id), players };
  });

  // owned picks from live traded_picks (roster_id = original owner,
  // owner_id = current owner)
  const seasons = [...new Set((tradedPicks || []).map((t) => parseInt(t.season, 10)))]
    .filter((y) => y >= new Date().getFullYear())
    .sort();
  const yearNow = new Date().getFullYear();
  const pickSeasons = seasons.length ? seasons : [yearNow, yearNow + 1, yearNow + 2];
  const picksByRoster = Object.fromEntries(rosters.map((r) => [r.roster_id, []]));
  for (const season of pickSeasons) {
    for (let round = 1; round <= 4; round++) {
      for (const r of rosters) {
        const traded = (tradedPicks || []).find(
          (t) => parseInt(t.season, 10) === season && t.round === round && t.roster_id === r.roster_id,
        );
        const owner = traded ? traded.owner_id : r.roster_id;
        if (picksByRoster[owner]) {
          picksByRoster[owner].push(`${season} R${round}${owner !== r.roster_id ? ` (via ${nameFor(r.roster_id)})` : ''}`);
        }
      }
    }
  }
  for (const s of section) s.picks = picksByRoster[s.rosterID] || [];
  return section;
}
