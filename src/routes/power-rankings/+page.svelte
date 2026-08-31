<script>
	import TrendChart from '$lib/TrendChart.svelte';
	import { getLeagueTeamManagers, gotoManager } from '$lib/utils/helper';
	import { getAvatarFromTeamManagers } from '$lib/utils/helperFunctions/universalFunctions';

	let data = $state(null);
	let loading = $state(true);
	let error = $state(false);
	let ltm = $state(null);
	let view = $state('rankings');
	let open = $state({});
	let axis = $state('proj'); // heatmap position axis: proj | value
	const posColor = { QB: '#7c3aed', RB: '#16a34a', WR: '#2563eb', TE: '#d97706' };
	let includePicks = $state(true);
	let teamA = $state(null);
	let teamB = $state(null);
	let posFilter = $state('ALL');
	const POS = ['QB', 'RB', 'WR', 'TE'];
	const posLabel = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PICK: 'Picks', OTHER: 'Other' };
	const stackKeys = $derived(includePicks ? ['QB', 'RB', 'WR', 'TE', 'PICK'] : ['QB', 'RB', 'WR', 'TE']);
	const stackColor = { ...posColor, PICK: '#9ca3af', OTHER: '#d1d5db' };
	const stackTotal = (t) => stackKeys.reduce((a, k) => a + (t.valueByPos?.[k] || 0), 0);
	const byValue = $derived([...teams].sort((a, b) => stackTotal(b) - stackTotal(a)));
	const maxStack = $derived(Math.max(...teams.map(stackTotal), 1));
	const leagueAvg = $derived.by(() => {
		const avg = {};
		for (const k of ['QB', 'RB', 'WR', 'TE', 'PICK']) avg[k] = teams.reduce((a, t) => a + (t.valueByPos?.[k] || 0), 0) / Math.max(n, 1);
		return avg;
	});
	const posRankOf = (t, k) => [...teams].sort((a, b) => (b.valueByPos?.[k] || 0) - (a.valueByPos?.[k] || 0)).findIndex((x) => x.rosterID === t.rosterID) + 1;
	const teamById = (rid) => teams.find((t) => t.rosterID === Number(rid)) || null;
	const selA = $derived(teamById(teamA) || teams[0] || null);
	const selB = $derived(teamById(teamB) || teams[1] || null);
	const grouped = (t) => {
		const g = { QB: [], RB: [], WR: [], TE: [], OTHER: [] };
		for (const pl of t?.roster || []) (g[pl.pos] || g.OTHER).push(pl);
		return g;
	};
	const trendClass = (v) => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
	const signed = (v) => (v > 0 ? '+' : '') + fmtK(v);
	const ageLabel = (a) => a == null ? '' : a.toFixed(1);
	const statusTag = (st) => st === 'taxi' ? 'TAXI' : st === 'ir' ? 'IR' : '';

	(async () => {
		try {
			const res = await fetch('/data/power-rankings.json');
			data = res.ok ? await res.json() : null;
			if (!data) error = true;
		} catch { error = true; }
		loading = false;
		try { ltm = await getLeagueTeamManagers(); } catch { /* avatars optional */ }
	})();

	const avatar = (rid) => { try { return ltm ? getAvatarFromTeamManagers(ltm, rid, ltm.currentSeason) : null; } catch { return null; } };
	const go = (rid) => { if (ltm) gotoManager({ year: ltm.currentSeason, leagueTeamManagers: ltm, rosterID: rid }); };
	const teams = $derived(data?.teams || []);
	const n = $derived(teams.length);
	const topComposite = $derived(Math.max(...teams.map((t) => t.composite), 0.0001));
	const movement = (t) => t.prevRank == null ? null : t.prevRank - t.rank;
	const medal = (rank) => rank <= 3 ? `/awards/record-${rank}.svg` : rank === n ? '/awards/toilet.svg' : null;
	const ago = (iso) => {
		if (!iso) return '';
		const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
		return h < 1 ? 'just now' : h < 36 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
	};
	const fmtK = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)));
	const record = (t) => `${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}`;
	const slotLabel = (s) => s === 'SUPER_FLEX' ? 'SF' : s === 'FLEX' ? 'FLX' : s;
	// heat: rank 1 = green, rank n = red, via hue
	const heat = (rank) => {
		if (!rank) return 'transparent';
		const t = (rank - 1) / Math.max(n - 1, 1);
		return `hsl(${Math.round(140 - t * 140)}, 70%, ${92 - t * 10}%)`;
	};
	const heatInk = (rank) => { const t = (rank - 1) / Math.max(n - 1, 1); return t > 0.75 ? '#7f1d1d' : t < 0.25 ? '#14532d' : '#374151'; };
	const cols = $derived([
		{ key: 'rank', label: 'Overall', get: (t) => t.rank },
		...(data?.preseason ? [] : [
			{ key: 'recordRank', label: 'Record', get: (t) => t.recordRank },
			{ key: 'pfRank', label: 'Points', get: (t) => t.pfRank },
			{ key: 'apRank', label: 'All-play', get: (t) => t.apRank },
		]),
		{ key: 'projRank', label: 'Season proj.', get: (t) => t.projRank },
		{ key: 'valueRank', label: 'Dynasty value', get: (t) => t.valueRank },
		...['QB', 'RB', 'WR', 'TE'].map((pos) => ({ key: pos, label: pos, get: (t) => t.posStrength?.[pos]?.[axis + 'Rank'] })),
	]);
	// in-season ranks for the heatmap (derived here so the bake stays simple)
	const withRanks = $derived.by(() => {
		if (!teams.length) return teams;
		const rankBy = (f) => { const order = [...teams].sort((a, b) => f(b) - f(a)); return Object.fromEntries(order.map((t, i) => [t.rosterID, i + 1])); };
		const rec = rankBy((t) => (t.wins + 0.5 * t.ties) / Math.max(t.wins + t.losses + t.ties, 1) + t.fpts / 1e6);
		const pf = rankBy((t) => t.fpts);
		const ap = rankBy((t) => (t.allPlayW || 0) / Math.max((t.allPlayW || 0) + (t.allPlayL || 0), 1));
		return teams.map((t) => ({ ...t, recordRank: rec[t.rosterID], pfRank: pf[t.rosterID], apRank: ap[t.rosterID] }));
	});
	const maxPos = $derived.by(() => {
		const m = {};
		for (const pos of ['QB', 'RB', 'WR', 'TE']) m[pos] = Math.max(...teams.map((t) => t.posStrength?.[pos]?.proj || 0), 1);
		return m;
	});
</script>

<svelte:head>
	<title>Power Rankings | ACT, or DIE.</title>
</svelte:head>

<style>
	.pr { max-width: 980px; margin: 0 auto; padding: 24px 16px 60px; color: var(--ink); }
	.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 4px; }
	h2 { margin: 0; font-size: 1.6em; }
	.meta { color: var(--muted); font-size: 0.88em; }
	.method { color: var(--muted); font-size: 0.86em; margin: 0 0 16px; max-width: 720px; line-height: 1.5; }
	.tabs { display: flex; gap: 4px; margin: 0 0 18px; border-bottom: 1px solid var(--line); overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
	.tabs::-webkit-scrollbar { display: none; }
	.tabs button { white-space: nowrap; flex-shrink: 0; }
	.tabs button { font: inherit; font-size: 0.92em; font-weight: 600; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 8px 14px; color: var(--muted); cursor: pointer; }
	.tabs button.on { color: var(--accent, #2563eb); border-bottom-color: var(--accent, #2563eb); }
	.loading, .empty { color: var(--muted); text-align: center; padding: 40px 0; }

	/* rankings list */
	.row { border: 1px solid var(--line); border-radius: 12px; background: var(--fff); margin-bottom: 8px; overflow: hidden; }
	.row.top { border-color: color-mix(in srgb, var(--accent, #2563eb) 35%, var(--line)); }
	.main { display: grid; grid-template-columns: 44px 44px 1fr auto; gap: 12px; align-items: center; padding: 12px 14px; cursor: pointer; }
	.rankNo { font-size: 1.5em; font-weight: 800; text-align: center; line-height: 1; letter-spacing: -0.03em; }
	.rankNo img { width: 30px; height: 30px; display: block; margin: 0 auto; }
	.av { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); object-fit: cover; background: var(--fff); }
	.who { min-width: 0; }
	.name { font-weight: 700; font-size: 1.02em; line-height: 1.2; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.move { font-size: 0.74em; font-weight: 700; padding: 1px 6px; border-radius: 999px; }
	.move.up { color: #16a34a; background: color-mix(in srgb, #16a34a 15%, transparent); } .move.down { color: #dc2626; background: color-mix(in srgb, #dc2626 15%, transparent); } .move.flat { color: var(--muted); background: var(--eee); }
	.sub { color: var(--muted); font-size: 0.84em; margin-top: 2px; display: flex; flex-wrap: wrap; gap: 4px 10px; }
	.sub b { color: var(--ink); font-weight: 600; }
	.strength { width: 180px; }
	.strength .track { height: 8px; background: var(--eee); border-radius: 999px; overflow: hidden; }
	.strength .fill { height: 100%; background: linear-gradient(90deg, #93c5fd, var(--accent, #2563eb)); border-radius: 999px; }
	.strength .lab { font-size: 0.74em; color: var(--muted); text-align: right; margin-top: 3px; font-variant-numeric: tabular-nums; }
	.blurb { grid-column: 3 / -1; color: var(--muted); font-size: 0.86em; font-style: italic; margin-top: -4px; }
	.chev { grid-column: 1 / -1; text-align: center; color: var(--muted); font-size: 0.7em; margin-top: -8px; }

	/* expanded */
	.detail { border-top: 1px solid var(--line); background: var(--f8f8f8); padding: 14px; display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; }
	.detail h5 { margin: 0 0 8px; font-size: 0.8em; font-weight: 700; color: var(--muted); }
	table { width: 100%; border-collapse: collapse; font-size: 0.86em; }
	td { padding: 5px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
	td.slot { color: var(--muted); font-weight: 700; font-size: 0.8em; width: 34px; }
	td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.pos { display: inline-block; font-size: 0.7em; font-weight: 700; color: #fff; padding: 1px 5px; border-radius: 4px; margin-right: 6px; vertical-align: 1px; }
	.nfl { color: var(--muted); font-size: 0.82em; margin-left: 4px; }
	.prank { display: inline-block; min-width: 34px; text-align: center; font-size: 0.78em; font-weight: 700; padding: 2px 5px; border-radius: 6px; }
	.psRow { display: grid; grid-template-columns: 30px 1fr auto auto; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 0.86em; }
	.psRow .lbl { font-weight: 700; }
	.psRow .track { height: 8px; background: var(--eee); border-radius: 999px; overflow: hidden; }
	.psRow .fill { height: 100%; border-radius: 999px; }
	.psRow .val { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.9em; white-space: nowrap; }
	.depthNote { margin-top: 12px; color: var(--muted); font-size: 0.82em; line-height: 1.5; }
	.depthNote b { color: var(--ink); font-weight: 600; }

	/* heatmap */
	.heatWrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
	.heat { border-collapse: separate; border-spacing: 3px; font-size: 0.86em; min-width: 640px; width: 100%; }
	.heat th { font-weight: 600; color: var(--muted); font-size: 0.82em; padding: 4px 6px; text-align: center; white-space: nowrap; }
	.heat th.team { text-align: left; }
	.heat td { text-align: center; padding: 8px 6px; border-radius: 6px; font-weight: 700; font-variant-numeric: tabular-nums; }
	.heat td.team { text-align: left; font-weight: 600; background: var(--fff); white-space: nowrap; position: sticky; left: 0; z-index: 1; box-shadow: 4px 0 8px -6px rgba(0,0,0,0.25); }
	.heat th.team { position: sticky; left: 0; background: var(--f3f3f3); z-index: 1; }
	.heat td.team img { width: 22px; height: 22px; border-radius: 50%; vertical-align: middle; margin-right: 8px; }
	.axisToggle { display: flex; gap: 4px; align-items: center; margin: 0 0 10px; font-size: 0.84em; color: var(--muted); }
	.axisToggle button { font: inherit; font-size: 0.92em; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--fff); color: var(--muted); cursor: pointer; }
	.axisToggle button.on { background: var(--accent, #2563eb); color: #fff; border-color: var(--accent, #2563eb); }
	.legendHeat { display: flex; gap: 6px; align-items: center; margin-top: 10px; font-size: 0.78em; color: var(--muted); }
	.legendHeat i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; }

	/* value stacks */
	.stacks { display: flex; flex-direction: column; gap: 6px; }
	.stackRow { display: grid; grid-template-columns: 26px 30px 1fr; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 10px; cursor: pointer; }
	.stackRow:hover { background: var(--fff); }
	.stackRank { font-weight: 800; color: var(--muted); text-align: center; font-size: 0.9em; }
	.stackAv { width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--line); object-fit: cover; background: var(--fff); display: inline-block; }
	.stackName { font-size: 0.88em; font-weight: 600; margin-bottom: 4px; display: flex; gap: 8px; align-items: baseline; }
	.stackTotal { color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums; }
	.stackTrend { font-size: 0.8em; font-weight: 600; font-variant-numeric: tabular-nums; }
	.stackTrend.up { color: #16a34a; } .stackTrend.down { color: #dc2626; } .stackTrend.flat { color: var(--muted); }
	.stackBar { display: flex; height: 22px; border-radius: 6px; overflow: hidden; background: var(--eee); }
	.stackBar .seg { height: 100%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.72em; font-weight: 700; overflow: hidden; white-space: nowrap; }
	.stackBar .seg + .seg { border-left: 1px solid rgba(255,255,255,0.35); }
	.stackLegend { margin-left: auto; display: flex; gap: 10px; font-size: 0.9em; }
	.stackLegend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
	.foot { color: var(--muted); font-size: 0.82em; margin-top: 12px; line-height: 1.5; }

	/* team + compare */
	.pickRow { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
	.pickRow select { font: inherit; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--fff); color: var(--ink); max-width: 100%; color-scheme: light dark; }
	.vs { color: var(--muted); font-weight: 700; font-size: 0.85em; }
	.teamHead { display: flex; gap: 14px; align-items: center; margin-bottom: 14px; }
	.av.big { width: 64px; height: 64px; }
	.teamDetail, .cmpLineups { border: 1px solid var(--line); border-radius: 12px; border-top: 1px solid var(--line); }
	.avgTrack { position: relative; }
	.avgTick { position: absolute; top: -3px; width: 2px; height: 14px; background: var(--ink); opacity: 0.7; }
	.picks { display: flex; flex-wrap: wrap; gap: 6px; }
	.pick { font-size: 0.78em; font-weight: 600; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--fff); }
	.pick.own { border-color: color-mix(in srgb, var(--accent, #2563eb) 40%, var(--line)); }
	.pick em { font-style: normal; color: var(--muted); font-weight: 500; }
	.posTabs { display: flex; gap: 4px; margin-bottom: 8px; }
	.posTabs button { font: inherit; font-size: 0.78em; font-weight: 600; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--fff); color: var(--muted); cursor: pointer; }
	.posTabs button.on { background: var(--ink); color: var(--fff); border-color: var(--ink); }
	.rosterTbl th { text-align: left; font-size: 0.74em; color: var(--muted); font-weight: 600; padding: 2px 4px; }
	.rosterTbl th.num { text-align: right; }
	.rosterTbl tr.bench td { color: var(--muted); }
	.tag { font-size: 0.66em; font-weight: 700; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; margin-left: 6px; vertical-align: 1px; }
	td.up { color: #16a34a; } td.down { color: #dc2626; } td.flat { color: var(--muted); }
	.cmpHead { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
	.cmpTeam { display: flex; gap: 10px; align-items: center; }
	.cmpTeam.right { justify-content: flex-end; text-align: right; }
	.cmpTeam.right .sub { justify-content: flex-end; }
	.mirror { background: var(--fff); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
	.mRowC { display: grid; grid-template-columns: 56px 1fr 60px 1fr 56px; gap: 8px; align-items: center; margin: 6px 0; font-size: 0.86em; }
	.mRowC.proj { font-size: 0.8em; }
	.mBar { height: 10px; background: var(--eee); border-radius: 999px; overflow: hidden; display: flex; }
	.mBar.left { justify-content: flex-end; }
	.mBar .fill { height: 100%; border-radius: 999px; }
	.mLbl { text-align: center; font-weight: 700; font-size: 0.85em; }
	.mVal { font-variant-numeric: tabular-nums; color: var(--muted); text-align: right; }
	.mVal.right { text-align: left; }
	.mVal.win { color: var(--ink); font-weight: 700; }

	@media (max-width: 640px) {
		.mRowC { grid-template-columns: 44px 1fr 44px 1fr 44px; font-size: 0.78em; }
		.cmpHead { grid-template-columns: 1fr; }
		.cmpTeam.right { justify-content: flex-start; text-align: left; flex-direction: row-reverse; }
		.stackLegend { display: none; }
		.stackBar .seg span { display: none; }
		.stackBar { height: 16px; }
		.main { grid-template-columns: 34px 36px 1fr; }
		.strength { grid-column: 1 / -1; width: auto; }
		.rankNo { font-size: 1.25em; } .rankNo img { width: 24px; height: 24px; }
		.av { width: 36px; height: 36px; }
		.detail { grid-template-columns: 1fr; }
		.blurb { grid-column: 1 / -1; }
	}
</style>

<div class="pr">
	<div class="head">
		<h2>Power Rankings</h2>
		{#if data}
			<span class="meta">{data.week ? `Week ${data.week}` : ''}{data.preseason ? ' · preseason edition' : ''} · updated {ago(data.generated)}</span>
		{/if}
	</div>
	<p class="method">
		{#if data?.preseason}
			Nothing has been played yet, so this ranks what each starting lineup projects to score this season (60%) blended with dynasty roster value (40%). Once games start, record and points take over and projections fade to a tiebreaker.
		{:else}
			Record (45%), points scored (30%), dynasty roster value (15%) and projected lineup strength (10%), blended into one ranking. Arrows compare to last week.
		{/if}
	</p>

	<div class="tabs">
		<button class:on={view === 'rankings'} onclick={() => view = 'rankings'}>Rankings</button>
		<button class:on={view === 'value'} onclick={() => view = 'value'}>Value</button>
		<button class:on={view === 'team'} onclick={() => view = 'team'}>Team</button>
		<button class:on={view === 'compare'} onclick={() => view = 'compare'}>Compare</button>
		<button class:on={view === 'heatmap'} onclick={() => view = 'heatmap'}>Heatmap</button>
		<button class:on={view === 'trends'} onclick={() => view = 'trends'}>Trends</button>
	</div>

	{#if loading}
		<p class="loading">Crunching the numbers…</p>
	{:else if error || !teams.length}
		<p class="empty">Power rankings haven't been baked yet — check back after the next refresh.</p>
	{:else if view === 'rankings'}
		{#each teams as t (t.rosterID)}
			{@const mv = movement(t)}
			<div class="row" class:top={t.rank <= 3}>
				<div class="main" onclick={() => open[t.rosterID] = !open[t.rosterID]} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (open[t.rosterID] = !open[t.rosterID])}>
					<div class="rankNo">{#if medal(t.rank)}<img src={medal(t.rank)} alt="rank {t.rank}" />{:else}{t.rank}{/if}</div>
					{#if avatar(t.rosterID)}<img class="av" src={avatar(t.rosterID)} alt="" />{:else}<span class="av"></span>{/if}
					<div class="who">
						<div class="name">
							{t.name.trim()}
							{#if mv != null}<span class="move" class:up={mv > 0} class:down={mv < 0} class:flat={mv === 0}>{mv > 0 ? '▲' + mv : mv < 0 ? '▼' + Math.abs(mv) : '—'}</span>{/if}
						</div>
						<div class="sub">
							{#if t.owner}<span>{t.owner}</span>{/if}
							{#if !data.preseason}<span><b>{record(t)}</b> · {t.fpts.toFixed(1)} pts{#if (t.allPlayW || 0) + (t.allPlayL || 0) > 0} · all-play {t.allPlayW}-{t.allPlayL}{/if}</span>{/if}
							<span>proj <b>{t.projTotal?.toLocaleString()}</b> (#{t.projRank})</span>
							<span>dynasty <b>{fmtK(t.rosterValue)}</b> (#{t.valueRank})</span>
						</div>
					</div>
					<div class="strength">
						<div class="track"><div class="fill" style="width: {Math.max(4, Math.round(t.composite / topComposite * 100))}%"></div></div>
						<div class="lab">{Math.round(t.composite / topComposite * 100)}</div>
					</div>
					{#if t.blurb}<div class="blurb">{t.blurb}</div>{/if}
					<div class="chev">{open[t.rosterID] ? '▲ hide lineup' : '▼ lineup & position strength'}</div>
				</div>
				{#if open[t.rosterID]}
					<div class="detail">
						<div>
							<h5>Optimal starting lineup · season projection</h5>
							<table>
								<tbody>
								{#each t.lineup || [] as l}
									<tr>
										<td class="slot">{slotLabel(l.slot)}</td>
										<td>{#if l.pos}<span class="pos" style="background: {posColor[l.pos] || '#6b7280'}">{l.pos}</span>{/if}{l.name || '—'}{#if l.team}<span class="nfl">{l.team}</span>{/if}</td>
										<td class="num">{l.proj ? l.proj.toFixed(1) : '—'}</td>
										<td class="num">{#if l.projPosRank}<span class="prank" style="background: {heat(Math.min(l.projPosRank, 24) / 24 * n)}; color: {heatInk(Math.min(l.projPosRank, 24) / 24 * n)}" title="league-wide {l.pos} rank by projection">{l.pos}{l.projPosRank}</span>{/if}</td>
									</tr>
								{/each}
								</tbody>
							</table>
							{#if t.bench?.length}
								<div class="depthNote">Bench depth: {#each t.bench.slice(0, 4) as b, i}{i ? ', ' : ''}<b>{b.name}</b> {b.proj.toFixed(0)}{/each}</div>
							{/if}
						</div>
						<div>
							<h5>Position strength · projected starters</h5>
							{#each ['QB', 'RB', 'WR', 'TE'] as pos}
								{@const ps = t.posStrength?.[pos]}
								{#if ps}
									<div class="psRow">
										<span class="lbl" style="color: {posColor[pos]}">{pos}</span>
										<div class="track"><div class="fill" style="width: {Math.round(ps.proj / maxPos[pos] * 100)}%; background: {posColor[pos]}"></div></div>
										<span class="prank" style="background: {heat(ps.projRank)}; color: {heatInk(ps.projRank)}">#{ps.projRank}</span>
										<span class="val">{ps.proj} pts · dyn #{ps.valueRank}</span>
									</div>
								{/if}
							{/each}
							<div class="depthNote">Ranks are among the {n} teams. Player ranks are among all rostered players at that position, by Sleeper's season projection.</div>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	{:else if view === 'value'}
		<div class="axisToggle">
			<button class:on={includePicks} onclick={() => includePicks = true}>Full team + picks</button>
			<button class:on={!includePicks} onclick={() => includePicks = false}>Players only</button>
			<span class="stackLegend">{#each stackKeys as k}<i style="background: {stackColor[k]}"></i>{posLabel[k]} {/each}</span>
		</div>
		<div class="stacks">
			{#each byValue as t, i (t.rosterID)}
				<div class="stackRow" onclick={() => { teamA = t.rosterID; view = 'team'; }} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (teamA = t.rosterID, view = 'team')}>
					<span class="stackRank">{i + 1}</span>
					{#if avatar(t.rosterID)}<img class="stackAv" src={avatar(t.rosterID)} alt="" />{:else}<span class="stackAv"></span>{/if}
					<div class="stackBody">
						<div class="stackName">{t.name.trim()} <span class="stackTotal">{fmtK(stackTotal(t))}</span> <span class="stackTrend {trendClass(t.trend30)}">{signed(t.trend30)} 30d</span></div>
						<div class="stackBar">
							{#each stackKeys as k}
								{#if t.valueByPos?.[k]}
									<div class="seg" style="width: {t.valueByPos[k] / maxStack * 100}%; background: {stackColor[k]}" title="{posLabel[k]} {fmtK(t.valueByPos[k])}">
										{#if t.valueByPos[k] / maxStack > 0.09}<span>{fmtK(t.valueByPos[k])}</span>{/if}
									</div>
								{/if}
							{/each}
						</div>
					</div>
				</div>
			{/each}
		</div>
		<p class="foot">Dynasty value per FantasyCalc (superflex, 0.5 PPR); picks valued for the next three drafts. "30d" is the roster's 30-day market movement — the sum of every player's value change. Click a team for the breakdown.</p>
	{:else if view === 'team'}
		{#if selA}
			<div class="pickRow">
				<select value={selA.rosterID} onchange={(e) => teamA = Number(e.target.value)}>
					{#each teams as t}<option value={t.rosterID}>{t.name.trim()}</option>{/each}
				</select>
				<span class="stackTrend {trendClass(selA.trend30)}">{signed(selA.trend30)} last 30 days</span>
			</div>
			<div class="teamHead">
				{#if avatar(selA.rosterID)}<img class="av big" src={avatar(selA.rosterID)} alt="" />{/if}
				<div>
					<div class="name">{selA.name.trim()}</div>
					<div class="sub"><span>{selA.owner}</span><span>power <b>#{selA.rank}</b></span><span>dynasty <b>{fmtK(selA.totalValue)}</b> (#{selA.valueRank})</span><span>proj <b>{selA.projTotal?.toLocaleString()}</b> (#{selA.projRank})</span>{#if selA.avgAge}<span>avg age <b>{selA.avgAge}</b></span>{/if}</div>
				</div>
			</div>
			<div class="detail teamDetail">
				<div>
					<h5>Value by position vs league average</h5>
					{#each ['QB', 'RB', 'WR', 'TE', 'PICK'] as k}
						{@const v = selA.valueByPos?.[k] || 0}
						{@const mx = Math.max(...teams.map((t) => t.valueByPos?.[k] || 0), 1)}
						<div class="psRow">
							<span class="lbl" style="color: {stackColor[k]}">{posLabel[k]}</span>
							<div class="track avgTrack"><div class="fill" style="width: {Math.round(v / mx * 100)}%; background: {stackColor[k]}"></div><i class="avgTick" style="left: {Math.round(leagueAvg[k] / mx * 100)}%" title="league average"></i></div>
							<span class="prank" style="background: {heat(posRankOf(selA, k))}; color: {heatInk(posRankOf(selA, k))}">#{posRankOf(selA, k)}</span>
							<span class="val">{fmtK(v)} · avg {fmtK(leagueAvg[k])}</span>
						</div>
					{/each}
					<h5 style="margin-top: 16px">Draft picks</h5>
					{#if selA.picks?.length}
						<div class="picks">{#each selA.picks as pk}<span class="pick" class:own={pk.orig === selA.rosterID} title="{fmtK(pk.value)}">{pk.season} R{pk.round}{#if pk.orig !== selA.rosterID} <em>via {pk.origName}</em>{/if}</span>{/each}</div>
					{:else}<p class="depthNote">No picks in the next three drafts.</p>{/if}
				</div>
				<div>
					<div class="posTabs">{#each ['ALL', ...POS] as k}<button class:on={posFilter === k} onclick={() => posFilter = k}>{k}</button>{/each}</div>
					<table class="rosterTbl">
						<thead><tr><th>Player</th><th class="num">Age</th><th class="num">Value</th><th class="num">30d</th><th class="num">Proj</th></tr></thead>
						<tbody>
							{#each (posFilter === 'ALL' ? POS : [posFilter]) as k}
								{#each grouped(selA)[k] as pl}
									<tr class:bench={pl.status !== 'active'}>
										<td><span class="pos" style="background: {posColor[pl.pos] || '#6b7280'}">{pl.pos}</span>{pl.name}{#if pl.team}<span class="nfl">{pl.team}</span>{/if}{#if statusTag(pl.status)}<span class="tag">{statusTag(pl.status)}</span>{/if}</td>
										<td class="num">{ageLabel(pl.age)}</td>
										<td class="num">{pl.value.toLocaleString()}</td>
										<td class="num {trendClass(pl.trend30)}">{pl.trend30 ? (pl.trend30 > 0 ? '+' : '') + pl.trend30 : '·'}</td>
										<td class="num">{pl.proj ? pl.proj.toFixed(0) : '·'}</td>
									</tr>
								{/each}
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{:else if view === 'compare'}
		{#if selA && selB}
			<div class="pickRow two">
				<select value={selA.rosterID} onchange={(e) => teamA = Number(e.target.value)}>{#each teams as t}<option value={t.rosterID}>{t.name.trim()}</option>{/each}</select>
				<span class="vs">vs</span>
				<select value={selB.rosterID} onchange={(e) => teamB = Number(e.target.value)}>{#each teams as t}<option value={t.rosterID}>{t.name.trim()}</option>{/each}</select>
			</div>
			<div class="cmpHead">
				<div class="cmpTeam">{#if avatar(selA.rosterID)}<img class="av" src={avatar(selA.rosterID)} alt="" />{/if}<div><div class="name">{selA.name.trim()}</div><div class="sub"><span>#{selA.rank} power</span><span>{fmtK(selA.totalValue)} dynasty</span><span>{selA.projTotal?.toLocaleString()} proj</span></div></div></div>
				<div class="cmpTeam right"><div><div class="name">{selB.name.trim()}</div><div class="sub"><span>#{selB.rank} power</span><span>{fmtK(selB.totalValue)} dynasty</span><span>{selB.projTotal?.toLocaleString()} proj</span></div></div>{#if avatar(selB.rosterID)}<img class="av" src={avatar(selB.rosterID)} alt="" />{/if}</div>
			</div>
			<div class="mirror">
				{#each ['QB', 'RB', 'WR', 'TE', 'PICK'] as k}
					{@const a = selA.valueByPos?.[k] || 0}
					{@const b = selB.valueByPos?.[k] || 0}
					{@const mx = Math.max(a, b, 1)}
					<div class="mRowC">
						<span class="mVal" class:win={a > b}>{fmtK(a)}</span>
						<div class="mBar left"><div class="fill" style="width: {a / mx * 100}%; background: {stackColor[k]}"></div></div>
						<span class="mLbl" style="color: {stackColor[k]}">{posLabel[k]}</span>
						<div class="mBar"><div class="fill" style="width: {b / mx * 100}%; background: {stackColor[k]}"></div></div>
						<span class="mVal right" class:win={b > a}>{fmtK(b)}</span>
					</div>
				{/each}
				{#each ['QB', 'RB', 'WR', 'TE'] as k}
					{@const a = selA.posStrength?.[k]?.proj || 0}
					{@const b = selB.posStrength?.[k]?.proj || 0}
					{@const mx = Math.max(a, b, 1)}
					<div class="mRowC proj">
						<span class="mVal" class:win={a > b}>{a} pts</span>
						<div class="mBar left"><div class="fill" style="width: {a / mx * 100}%; background: {posColor[k]}; opacity: 0.55"></div></div>
						<span class="mLbl">{k} proj</span>
						<div class="mBar"><div class="fill" style="width: {b / mx * 100}%; background: {posColor[k]}; opacity: 0.55"></div></div>
						<span class="mVal right" class:win={b > a}>{b} pts</span>
					</div>
				{/each}
			</div>
			<div class="detail cmpLineups">
				{#each [selA, selB] as t}
					<div>
						<h5>{t.name.trim()} · projected starters</h5>
						<table><tbody>{#each t.lineup || [] as l}<tr><td class="slot">{slotLabel(l.slot)}</td><td>{#if l.pos}<span class="pos" style="background: {posColor[l.pos] || '#6b7280'}">{l.pos}</span>{/if}{l.name || '—'}</td><td class="num">{l.proj ? l.proj.toFixed(1) : '—'}</td></tr>{/each}</tbody></table>
					</div>
				{/each}
			</div>
			<p class="foot">Top row: dynasty value by position (solid). Second row: this season's projected points from the starters at each position (faded). Bold value marks the stronger side.</p>
		{/if}
	{:else if view === 'heatmap'}
		<div class="axisToggle">
			Position columns by
			<button class:on={axis === 'proj'} onclick={() => axis = 'proj'}>projection</button>
			<button class:on={axis === 'value'} onclick={() => axis = 'value'}>dynasty value</button>
		</div>
		<div class="heatWrap">
			<table class="heat">
				<thead><tr><th class="team">Team</th>{#each cols as c}<th>{c.label}</th>{/each}</tr></thead>
				<tbody>
					{#each withRanks as t (t.rosterID)}
						<tr>
							<td class="team">{#if avatar(t.rosterID)}<img src={avatar(t.rosterID)} alt="" />{/if}{t.name.trim()}</td>
							{#each cols as c}
								{@const r = c.get(t)}
								<td style="background: {heat(r)}; color: {heatInk(r)}">{r ?? '—'}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="legendHeat"><span>Rank</span><i style="background: {heat(1)}"></i>1<i style="background: {heat(Math.ceil(n / 2))}"></i>{Math.ceil(n / 2)}<i style="background: {heat(n)}"></i>{n}</div>
	{:else}
		<TrendChart metric="valueRank" metricOptions={[['valueRank', 'Rank'], ['value', 'Value']]} title="Roster value over time" subtitle="Each roster's dynasty value (players plus future picks) and where it ranks. Points before the season are reconstructed from the transaction ledger at current prices, so the line shows what each manager built, not price swings." />
		<TrendChart metric="rank" title="Power rank over time" subtitle="The composite power rank from each bake. Starts accumulating from the first in-season bake." />
	{/if}
</div>
