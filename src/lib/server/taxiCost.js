/*
  Taxi-squad claim cost, straight out of constitution section 4.3.

  The rule:
    - compensation is a pick in the next annual draft, ONE round higher
      than the round the player was originally drafted in this league
    - minimum cost is a 3rd round pick
    - a player drafted in the 1st round costs a 1st AND a 2nd
    - a player who went undrafted in the annual draft costs a 3rd
    - Raeger Rule: a player who was dropped to waivers and then picked
      up as a free agent has his cost reset to a 3rd, regardless of the
      draft capital he was originally taken with (trades do NOT reset it)

  Kept in one module because build-knowledge.mjs (bake time) and
  liveRosters.js (question time) must agree exactly - if they drift, the
  Oracle quotes one price on Tuesday and another on Wednesday.
*/

/**
 * @param {{ round?: number|null, dropped?: boolean }} opts
 * @param {number|string} season - the draft the compensation comes out of
 * @returns {string} human-readable cost, e.g. "a 2026 1st AND a 2026 2nd"
 */
export function taxiClaimCost({ round = null, dropped = false } = {}, season) {
	const yr = season ? `${season} ` : '';
	const ord = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

	// Raeger Rule and undrafted both bottom out at a 3rd
	if (dropped) return `a ${yr}3rd-round pick (Raeger Rule - he was dropped and re-acquired since his draft, which resets the cost to a 3rd)`;
	if (!round) return `a ${yr}3rd-round pick (he went undrafted in this league's annual drafts)`;
	if (round === 1) return `a ${yr}1st-round pick AND a ${yr}2nd-round pick (he was a 1st-round pick)`;

	const owed = Math.max(1, round - 1); // one round higher than drafted
	const capped = Math.min(3, owed); // ...but never cheaper than a 3rd
	const why =
		capped === owed
			? `one round higher than the R${round} pick he was drafted with`
			: `the 3rd-round minimum, since he was drafted in R${round}`;
	return `a ${yr}${ord(capped)}-round pick (${why})`;
}

/**
 * Parse the compact draftedBy label the pack carries ("2023 R2").
 * @param {string|undefined|null} label
 * @returns {number|null} the round, or null if undrafted/unparseable
 */
export function roundFromLabel(label) {
	const m = /R(\d+)/.exec(String(label || ''));
	return m ? parseInt(m[1], 10) : null;
}
