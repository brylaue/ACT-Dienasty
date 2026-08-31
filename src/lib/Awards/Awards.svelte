<script>
	import { gotoManager } from '$lib/utils/helper';
	import { getAvatarFromTeamManagers, getNestedTeamNamesFromTeamManagers } from '$lib/utils/helperFunctions/universalFunctions';
	export let podium, leagueTeamManagers;

	const { year, champion, second, third, divisions, toilet } = podium;

	const go = (rosterID) => gotoManager({year, leagueTeamManagers, rosterID});
	const avatar = (rosterID) => getAvatarFromTeamManagers(leagueTeamManagers, rosterID, year);
	const names = (rosterID) => getNestedTeamNamesFromTeamManagers(leagueTeamManagers, year, rosterID);

	// display order 2 - 1 - 3, with the material and proportions of each step
	const places = [
		{ rosterID: second,   n: 2, metal: 'silver', height: 150, avatar: 96 },
		{ rosterID: champion, n: 1, metal: 'gold',   height: 212, avatar: 124 },
		{ rosterID: third,    n: 3, metal: 'bronze', height: 118, avatar: 96 },
	];
</script>

<style>
	.awards {
		--gold: #c9a227;
		--gold-light: #f3dc8a;
		--gold-deep: #9a7a1e;
		--silver: #b4bdc7;
		--silver-light: #f1f4f7;
		--silver-deep: #8a939d;
		--bronze: #b5773f;
		--bronze-light: #e8b57e;
		--bronze-deep: #8a5a2b;
		position: relative;
		width: 100%;
		max-width: 860px;
		margin: 0 auto;
		padding: 0 16px 40px;
		z-index: 1;
		color: var(--ink);
	}

	h3 {
		margin: 2.2em 0 1.2em;
		text-align: center;
	}

	/* ceremonial divider: thin metal rule, mark centered */
	.rule {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 18px;
		margin: 8px auto 6px;
		max-width: 520px;
	}
	.rule::before, .rule::after {
		content: '';
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--rule-color));
	}
	.rule::after { background: linear-gradient(90deg, var(--rule-color), transparent); }
	.rule img { width: 56px; height: 56px; display: block; }
	.rule.gold { --rule-color: var(--gold); }
	.rule.porcelain { --rule-color: var(--silver); }

	.caption {
		text-align: center;
		color: var(--muted);
		font-size: 0.92em;
		letter-spacing: 0.01em;
		margin: 0 0 28px;
	}

	/* the podium: three columns, steps grow from a shared floor */
	.podium {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		align-items: end;
		gap: 10px;
		max-width: 700px;
		margin: 0 auto;
	}
	.place {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.avatarWrap {
		position: relative;
		z-index: 2;
		margin-bottom: -14px; /* sits on the step's top edge */
		border-radius: 50%;
		padding: 4px;
		background: linear-gradient(160deg, var(--m-light), var(--m-deep));
		box-shadow: 0 6px 16px rgba(17, 24, 39, 0.14);
		cursor: pointer;
	}
	.avatarWrap img {
		display: block;
		border-radius: 50%;
		background: var(--fff);
		width: var(--size);
		height: var(--size);
		object-fit: cover;
	}
	.step {
		width: 100%;
		height: var(--h);
		border-radius: 10px 10px 4px 4px;
		background: var(--fff);
		border: 1px solid var(--line);
		border-top: none;
		box-shadow: 0 10px 24px -12px rgba(17, 24, 39, 0.28);
		position: relative;
		overflow: hidden;
	}
	.step::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 12px;
		background: linear-gradient(90deg, var(--m-light), var(--m-mid) 45%, var(--m-deep));
	}
	.numeral {
		position: absolute;
		left: 0; right: 0; bottom: 6px;
		text-align: center;
		font-weight: 800;
		font-size: 3.6em;
		line-height: 1;
		color: var(--m-mid);
		opacity: 0.45;
		letter-spacing: -0.03em;
		user-select: none;
	}
	.place.gold   { --m-light: var(--gold-light);   --m-mid: var(--gold);   --m-deep: var(--gold-deep); }
	.place.silver { --m-light: var(--silver-light); --m-mid: var(--silver); --m-deep: var(--silver-deep); }
	.place.bronze { --m-light: var(--bronze-light); --m-mid: var(--bronze); --m-deep: var(--bronze-deep); }

	.plate {
		margin-top: 12px;
		text-align: center;
		font-weight: 600;
		font-size: 0.95em;
		line-height: 1.3;
		cursor: pointer;
		min-height: 2.6em;
	}
	.plate :global(.nested) { display: block; font-weight: 400; color: var(--muted); font-size: 0.85em; }

	/* divisions */
	.divisions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 18px;
		margin: 48px auto 0;
	}
	.division { text-align: center; }
	.division h6 {
		margin: 0 0 14px;
		font-size: 0.98em;
		font-weight: 600;
	}
	.leaderBlock { position: relative; display: inline-block; }
	.divisionLeader {
		width: 72px; height: 72px;
		border-radius: 50%;
		border: 1px solid var(--line);
		background: var(--fff);
		object-fit: cover;
		display: block;
		cursor: pointer;
	}
	.shield {
		position: absolute;
		right: -6px; bottom: -6px;
		width: 30px; height: 30px;
		background: var(--fff);
		border-radius: 50%;
		padding: 3px;
		box-shadow: 0 2px 6px rgba(17, 24, 39, 0.16);
	}
	.genLabel { display: block; margin-top: 10px; font-weight: 600; font-size: 0.92em; cursor: pointer; }
	.genLabel :global(.nested) { display: block; font-weight: 400; color: var(--muted); font-size: 0.85em; }

	/* the Toilet Bowl */
	.toiletParent { margin: 56px auto 0; text-align: center; }
	.bowl {
		position: relative;
		width: 176px;
		height: 176px;
		margin: 6px auto 0;
	}
	.bowl img.trophy { width: 100%; height: 100%; display: block; }
	.bowl img.loser {
		position: absolute;
		width: 44px; height: 44px;
		left: 50%; top: 44%;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		border: 2px solid var(--fff);
		box-shadow: 0 2px 6px rgba(17, 24, 39, 0.2);
		object-fit: cover;
		cursor: pointer;
	}

	@media (max-width: 640px) {
		.podium { gap: 6px; }
		.numeral { font-size: 2.6em; }
		.plate { font-size: 0.85em; }
		.rule img { width: 46px; height: 46px; }
		.caption { font-size: 0.82em; padding: 0 8px; }
	}
	@media (max-width: 420px) {
		.avatarWrap { --size: 64px !important; }
		.place.gold .avatarWrap { --size: 80px !important; }
		.step { --h: calc(var(--h-base) * 0.8); }
	}
</style>

<div class="awards">
	<h3>{year} Awards</h3>

	<div class="rule gold"><img src="/trophy-mark.svg" alt="" /></div>
	<p class="caption">League Champion, Runner-up, and Third Place</p>

	<div class="podium">
		{#each places as p}
			<div class="place {p.metal}">
				<div class="avatarWrap" style="--size: {p.avatar}px" onclick={() => go(p.rosterID)} onkeydown={(e) => e.key === 'Enter' && go(p.rosterID)} role="button" tabindex="0">
					<img src={avatar(p.rosterID)} alt="place {p.n}" />
				</div>
				<div class="step" style="--h: {p.height}px; --h-base: {p.height}px">
					<div class="numeral">{p.n}</div>
				</div>
				<div class="plate" onclick={() => go(p.rosterID)} onkeydown={(e) => e.key === 'Enter' && go(p.rosterID)} role="button" tabindex="0">{@html names(p.rosterID)}</div>
			</div>
		{/each}
	</div>

	<div class="divisions">
		{#each divisions as division}
			{#if division.rosterID}
				<div class="division">
					{#if division.name}
						<h6>{division.name} Division</h6>
					{:else}
						<h6>Regular Season Champion</h6>
					{/if}
					<div class="leaderBlock">
						<img src={avatar(division.rosterID)} class="divisionLeader" onclick={() => go(division.rosterID)} alt="{division.name} champion" />
						<img src="/awards/division.svg" class="shield" alt="" />
					</div>
					<span class="genLabel" onclick={() => go(division.rosterID)} onkeydown={(e) => e.key === 'Enter' && go(division.rosterID)} role="button" tabindex="0">{@html names(division.rosterID)}</span>
				</div>
			{/if}
		{/each}
	</div>

	{#if toilet}
		<div class="toiletParent">
			<div class="rule porcelain"><img src="/toilet-mark.svg" alt="" /></div>
			<p class="caption">The Toilet Bowl — last one standing in the losers bracket</p>
			<div class="bowl">
				<img src="/toilet-mark.svg" class="trophy" alt="Toilet Bowl trophy" />
				<img src={avatar(toilet)} class="loser" onclick={() => go(toilet)} alt="toilet bowl winner" />
			</div>
			<span class="genLabel" onclick={() => go(toilet)} onkeydown={(e) => e.key === 'Enter' && go(toilet)} role="button" tabindex="0">{@html names(toilet)}</span>
		</div>
	{/if}
</div>
