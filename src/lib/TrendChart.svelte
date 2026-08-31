<script>
	import { onMount } from 'svelte';
	// metric: 'rank' (power rank, bake points only) | 'valueRank' (roster-value
	// rank, every point incl. backfill) | 'value' | 'playoffPct'
	let { metric: initialMetric = 'valueRank', metricOptions = null, title = 'Trends', subtitle = '' } = $props();
	let metric = $state(initialMetric);

	let ledger = $state(null);
	let period = $state('season');
	let focus = $state(null);

	onMount(async () => {
		try {
			const r = await fetch('/data/trends.json');
			if (r.ok) ledger = await r.json();
		} catch { /* no ledger yet */ }
	});

	const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#9f1239'];

	// one point per month in the off-season, one per NFL week (preseason
	// included) in season: the last bake in each bucket represents it
	const bucketKey = (p) => (p.phase && p.phase !== 'off' && p.week != null) ? `${p.d.slice(0, 4)}-${p.phase}-${String(p.week).padStart(2, '0')}` : p.d.slice(0, 7);
	const thinned = $derived.by(() => {
		if (!ledger) return [];
		const byKey = new Map();
		for (const p of ledger.points) byKey.set(bucketKey(p), p); // ledger is date-sorted, last wins
		return [...byKey.values()].sort((a, b) => a.d.localeCompare(b.d));
	});
	const points = $derived.by(() => {
		if (!ledger) return [];
		let pts = thinned.filter((p) => Object.values(p.teams).some((t) => t[metric] != null));
		if (period === '4w') {
			const cutoff = Date.now() - 28 * 864e5;
			const recent = pts.filter((p) => new Date(p.d).getTime() >= cutoff);
			pts = recent.length >= 2 ? recent : pts.slice(-2);
		} else if (period === 'season' && ledger.season) {
			pts = pts.filter((p) => p.d.startsWith(String(ledger.season)));
		}
		return pts;
	});
	const teamIDs = $derived(ledger ? Object.keys(ledger.teams) : []);
	const isRank = $derived(metric === 'rank' || metric === 'valueRank');
	let cw = $state(720);
	const narrow = $derived(cw < 600);
	const W = $derived(narrow ? 400 : 720);
	const H = $derived(narrow ? 260 : 300);
	const PL = 44, PT = 16, PB = 34;
	const PR = $derived(narrow ? 14 : 150);
	const xs = $derived(points.map((_, i) => PL + (points.length > 1 ? (i * (W - PL - PR)) / (points.length - 1) : 0)));
	const range = $derived.by(() => {
		if (isRank) return { lo: 1, hi: Math.max(teamIDs.length, 2) };
		const vals = points.flatMap((p) => Object.values(p.teams).map((t) => t[metric]).filter((v) => v != null));
		if (!vals.length) return { lo: 0, hi: 1 };
		const lo = Math.min(...vals), hi = Math.max(...vals);
		const pad = (hi - lo) * 0.08 || 1;
		return { lo: Math.max(metric === 'playoffPct' ? 0 : -Infinity, lo - pad), hi: hi + pad };
	});
	const y = (v) => {
		const { lo, hi } = range;
		const t = (v - lo) / (hi - lo || 1);
		return isRank ? PT + t * (H - PT - PB) : H - PB - t * (H - PT - PB);
	};
	const path = (rid) => {
		let d = '', pen = false;
		points.forEach((p, i) => {
			const v = p.teams[rid]?.[metric];
			if (v == null) { pen = false; return; }
			d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)},${y(v).toFixed(1)} `;
			pen = true;
		});
		return d;
	};
	const last = (rid) => {
		for (let i = points.length - 1; i >= 0; i--) { const v = points[i].teams[rid]?.[metric]; if (v != null) return { v, i }; }
		return null;
	};
	const first = (rid) => {
		for (let i = 0; i < points.length; i++) { const v = points[i].teams[rid]?.[metric]; if (v != null) return v; }
		return null;
	};
	const fmt = (v) => metric === 'value' ? Math.round(v / 1000) + 'k' : metric === 'playoffPct' ? v.toFixed(0) + '%' : '#' + v;
	const delta = (rid) => {
		const a = first(rid), b = last(rid)?.v;
		if (a == null || b == null) return null;
		return isRank ? a - b : b - a; // climbing ranks is positive
	};
	const legend = $derived(teamIDs
		.map((rid) => ({ rid, name: ledger.teams[rid], last: last(rid), delta: delta(rid) }))
		.filter((t) => t.last)
		.sort((a, b) => isRank ? a.last.v - b.last.v : b.last.v - a.last.v));
	const endLabelY = $derived.by(() => {
		const rows = legend.map((t) => ({ rid: t.rid, y: y(t.last.v) })).sort((a, b) => a.y - b.y);
		const GAP = 12.5;
		for (let i = 1; i < rows.length; i++) if (rows[i].y - rows[i - 1].y < GAP) rows[i].y = rows[i - 1].y + GAP;
		for (let i = rows.length - 1; i >= 0; i--) { const max = H - PB - 2 - (rows.length - 1 - i) * GAP; if (rows[i].y > max) rows[i].y = max; }
		return Object.fromEntries(rows.map((r) => [r.rid, r.y]));
	});
	const label = (p) => {
		const d = new Date(p.d + 'T12:00:00Z');
		if (p.phase === 'pre' && p.week) return `Pre ${p.week}`;
		if (p.phase === 'post' && p.week) return `Playoffs`;
		if (p.week) return `Wk ${p.week}`;
		return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
	};
	const longLabel = (p) => {
		const d = new Date(p.d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
		if (p.phase === 'pre' && p.week) return `Preseason week ${p.week} · ${d}`;
		if (p.week) return `${p.phase === 'post' ? 'Playoffs' : 'Week ' + p.week} · ${d}`;
		return `${d}${p.source === 'backfill' ? ' · reconstructed' : ''}`;
	};
	// hover state: which point index is under the cursor
	let hover = $state(null);
	let svgEl = $state(null);
	const onMove = (e) => {
		if (!svgEl || !points.length) return;
		const rect = svgEl.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * W;
		let best = 0;
		for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
		hover = best;
	};
	const hoverRows = $derived.by(() => {
		if (hover == null || !points[hover]) return [];
		const p = points[hover];
		const prev = hover > 0 ? points[hover - 1] : null;
		return teamIDs
			.map((rid) => ({ rid, name: ledger.teams[rid], v: p.teams[rid]?.[metric], pv: prev?.teams[rid]?.[metric] }))
			.filter((r) => r.v != null)
			.sort((a, b) => isRank ? a.v - b.v : b.v - a.v)
			.map((r) => ({ ...r, d: r.pv == null ? null : (isRank ? r.pv - r.v : r.v - r.pv) }));
	});
	const tickIdx = $derived(points.length <= 8 ? points.map((_, i) => i) : points.map((_, i) => i).filter((i) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 7) === 0));
</script>

<style>
	.trend { max-width: 980px; margin: 32px auto 0; padding: 0 16px; }
	.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px 16px; margin-bottom: 6px; }
	h4 { margin: 0; font-size: 1.05em; }
	.sub { color: var(--muted, #6b7280); font-size: 0.85em; flex-basis: 100%; margin: 0; }
	.periods { margin-left: auto; display: flex; gap: 4px; }
	.periods.metrics { margin-left: 0; }
	.periods button { font: inherit; font-size: 0.8em; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line, #e5e7eb); background: var(--fff, #fff); color: var(--muted, #6b7280); cursor: pointer; }
	.periods button.on { background: var(--accent, #2563eb); color: #fff; border-color: var(--accent, #2563eb); }
	.card { background: var(--fff, #fff); border: 1px solid var(--line, #e5e7eb); border-radius: 12px; padding: 12px 8px 4px; }
	svg { width: 100%; height: auto; display: block; }
	.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; transition: opacity 0.15s; }
	.dim .line { opacity: 0.12; }
	.dim .line.on { opacity: 1; stroke-width: 3; }
	.legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 2px 12px; padding: 10px 8px 6px; font-size: 0.82em; }
	.legend button { font: inherit; display: flex; align-items: center; gap: 8px; background: none; border: none; padding: 3px 4px; cursor: pointer; color: inherit; text-align: left; border-radius: 6px; }
	.legend button.on { background: color-mix(in srgb, var(--accent, #2563eb) 10%, transparent); }
	.swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
	.lname { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.lval { font-variant-numeric: tabular-nums; color: var(--muted, #6b7280); }
	.up { color: #16a34a; } .down { color: #dc2626; }
	.empty { color: var(--muted, #6b7280); font-size: 0.9em; padding: 12px; }
	.dot { opacity: 0.55; transition: r 0.1s; }
	.dot.on { opacity: 1; }
	.dim .dot { opacity: 0.1; } .dim .dot.on { opacity: 1; }
	.hoverLine { stroke: #9ca3af; stroke-dasharray: 3 3; }
	.tip { margin: 4px 8px 0; padding: 8px 10px; border: 1px solid var(--line, #e5e7eb); border-radius: 8px; background: #fff; font-size: 0.8em; }
	.tipHead { font-weight: 700; margin-bottom: 6px; }
	.tipGrid { display: grid; grid-template-columns: 10px 1fr auto auto; gap: 2px 10px; align-items: center; column-gap: 8px; max-height: 190px; overflow: auto; }
	.tipGrid .lval { text-align: right; }
	.flat { color: var(--muted, #6b7280); }
	@media (min-width: 700px) { .tipGrid { grid-template-columns: 10px 1fr auto auto 10px 1fr auto auto; } }
	.axis text { font-size: 10px; fill: #9ca3af; }
	.axis line { stroke: #eef0f3; }
	.endLabel { font-size: 10.5px; font-weight: 600; }
	@media (max-width: 640px) { .legend { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>

<section class="trend">
	<div class="head">
		<h4>{title}</h4>
		{#if metricOptions}
			<div class="periods metrics">
				{#each metricOptions as [k, l]}
					<button class:on={metric === k} onclick={() => metric = k}>{l}</button>
				{/each}
			</div>
		{/if}
		<div class="periods">
			{#each [['4w', 'Last 4 weeks'], ['season', 'This season'], ['all', 'All time']] as [k, l]}
				<button class:on={period === k} onclick={() => period = k}>{l}</button>
			{/each}
		</div>
		{#if subtitle}<p class="sub">{subtitle}</p>{/if}
	</div>
	<div class="card" bind:clientWidth={cw}>
		{#if !ledger}
			<p class="empty">Loading trends…</p>
		{:else if points.length < 2}
			<p class="empty">Not enough history yet - this chart fills in as the bakes accumulate.</p>
		{:else}
			<svg viewBox="0 0 {W} {H}" class:dim={focus != null} role="img" aria-label={title} bind:this={svgEl} onmousemove={onMove} onmouseleave={() => hover = null} ontouchstart={(e) => onMove(e.touches[0])} ontouchmove={(e) => onMove(e.touches[0])}>
				<g class="axis">
					{#each (isRank ? Array.from({ length: teamIDs.length }, (_, i) => i + 1) : [range.lo, (range.lo + range.hi) / 2, range.hi]) as v}
						<line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} />
						<text x={PL - 6} y={y(v) + 3.5} text-anchor="end">{isRank ? v : fmt(v)}</text>
					{/each}
					{#each tickIdx as i}
						<text x={xs[i]} y={H - 10} text-anchor="middle">{label(points[i])}</text>
					{/each}
				</g>
				{#if hover != null && xs[hover] != null}
					<line class="hoverLine" x1={xs[hover]} x2={xs[hover]} y1={PT} y2={H - PB} />
				{/if}
				{#each teamIDs as rid, k}
					<path class="line" class:on={focus === rid} d={path(rid)} stroke={PALETTE[k % PALETTE.length]} onclick={() => focus = focus === rid ? null : rid} role="button" tabindex="-1" />
					{#each points as p, i}
						{#if p.teams[rid]?.[metric] != null}
							<circle class="dot" class:on={focus === rid || hover === i} cx={xs[i]} cy={y(p.teams[rid][metric])} r={hover === i ? 3.6 : 2.4} fill={PALETTE[k % PALETTE.length]} />
						{/if}
					{/each}
				{/each}
				{#each narrow ? [] : legend as t, k}
					{@const idx = teamIDs.indexOf(t.rid)}
					<text class="endLabel" x={W - PR + 8} y={endLabelY[t.rid] + 3.5} fill={PALETTE[idx % PALETTE.length]} opacity={focus == null || focus === t.rid ? 1 : 0.25}>{t.name.length > 20 ? t.name.slice(0, 19) + '…' : t.name}</text>
				{/each}
			</svg>
			{#if hover != null && points[hover]}
				<div class="tip">
					<div class="tipHead">{longLabel(points[hover])}</div>
					<div class="tipGrid">
						{#each (focus ? hoverRows.filter((r) => r.rid === focus) : hoverRows) as r}
							{@const idx = teamIDs.indexOf(r.rid)}
							<span class="swatch" style="background: {PALETTE[idx % PALETTE.length]}"></span>
							<span class="lname">{r.name}</span>
							<span class="lval">{fmt(r.v)}</span>
							<span class={r.d > 0 ? 'up' : r.d < 0 ? 'down' : 'flat'}>{r.d == null ? '' : r.d === 0 ? '·' : (r.d > 0 ? '▲' : '▼') + (isRank ? Math.abs(r.d) : fmt(Math.abs(r.d)).replace('#', ''))}</span>
						{/each}
					</div>
				</div>
			{/if}
			<div class="legend">
				{#each legend as t}
					{@const idx = teamIDs.indexOf(t.rid)}
					<button class:on={focus === t.rid} onclick={() => focus = focus === t.rid ? null : t.rid}>
						<span class="swatch" style="background: {PALETTE[idx % PALETTE.length]}"></span>
						<span class="lname">{t.name}</span>
						<span class="lval">{fmt(t.last.v)}</span>
						{#if t.delta != null && t.delta !== 0}<span class={t.delta > 0 ? 'up' : 'down'}>{t.delta > 0 ? '▲' : '▼'}{isRank ? Math.abs(t.delta) : fmt(Math.abs(t.delta)).replace('#', '')}</span>{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</section>
