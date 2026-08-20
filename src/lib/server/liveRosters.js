/*
  Live roster layer for The Oracle: rebuilds the rosters section of the
  knowledge pack from Sleeper AT QUESTION TIME, so answers about who owns
  whom, taxi squads, and picks reflect the league as of right now - not
  the last Tuesday bake. Player names come from the baked players-lite
  index; original draft rounds from the baked draftedBy map and claim
  costs from the baked claimCosts map (neither changes between bakes).
  Any failure falls back to the baked rosters.

  Shape matters here: active roster, taxi squad, and IR go into SEPARATE
  lists rather than one list with flags appended. Sleeper returns taxi
  and IR players inside r.players, so a flat list reads as "on the active
  roster" to anything skimming it - which is exactly how the Oracle once
  told a manager that a taxi-squad player couldn't be claimed.
*/

import { taxiClaimCost, roundFromLabel } from './taxiCost.js';

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
	const dropped = new Set(knowledge.droppedPlayers || []);
	const claimSeason = knowledge.claimSeason || new Date().getFullYear();
	const nameFor = (rid) => names[rid] || `Team ${rid}`;

	const describe = (id) => {
		const [nm, pos] = (lite[id] || `Player ${id}|?`).split('|');
		const drafted = draftedBy[id]
			? `drafted ${draftedBy[id]}`
			: "undrafted in this league's annual drafts";
		return `${nm} (${pos}, ${drafted})`;
	};

	// draft capital never changes and the bake hands over the league's
	// drop history, so claims can be priced live for anyone - including
	// players added to a taxi squad since the last refresh
	const costFor = (id) =>
		taxiClaimCost({ round: roundFromLabel(draftedBy[id]), dropped: dropped.has(id) }, claimSeason);

	const section = rosters.map((r) => {
		const taxi = new Set(r.taxi || []);
		const ir = new Set(r.reserve || []);
		const activeRoster = [];
		const taxiSquad = [];
		const injuredReserve = [];

		for (const id of r.players || []) {
			if (taxi.has(id)) taxiSquad.push(`${describe(id)} - TAXI CLAIM COST: ${costFor(id)}`);
			else if (ir.has(id)) injuredReserve.push(describe(id));
			else activeRoster.push(describe(id));
		}

		return { rosterID: r.roster_id, name: nameFor(r.roster_id), activeRoster, taxiSquad, injuredReserve };
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
