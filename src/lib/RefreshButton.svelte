<script>
	import { onMount } from 'svelte';
	// last bake time comes from the power-rankings stamp - the file every
	// update rewrites, so it doubles as the site's "data as of" clock
	let generated = $state(null);
	let open = $state(false);
	let pass = $state('');
	let status = $state('');
	let busy = $state(false);

	onMount(async () => {
		try {
			const r = await fetch('/data/power-rankings.json');
			if (r.ok) generated = (await r.json()).generated || null;
		} catch { /* no stamp, no clock */ }
		try { pass = localStorage.getItem('refreshPass') || localStorage.getItem('oraclePass') || ''; } catch { /* private mode */ }
	});

	const ago = (iso) => {
		if (!iso) return '';
		const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
		if (m < 60) return `${Math.max(m, 1)} min ago`;
		const h = Math.round(m / 60);
		if (h < 36) return `${h} hr ago`;
		return `${Math.round(h / 24)} days ago`;
	};

	async function requestUpdate() {
		busy = true; status = '';
		try {
			const r = await fetch('/api/refresh', { method: 'POST', headers: { 'x-refresh-passcode': pass } });
			const d = await r.json().catch(() => ({}));
			status = d.message || (r.ok ? 'Update requested.' : 'Something went wrong.');
			if (r.ok) { try { localStorage.setItem('refreshPass', pass); } catch { /* ignore */ } }
		} catch {
			status = 'Could not reach the site. Try again shortly.';
		}
		busy = false;
	}
</script>

<style>
	.refresh { display: inline-flex; align-items: center; gap: 10px; font-size: 0.82em; color: var(--muted, #6b7280); }
	.refresh button {
		font: inherit; color: var(--accent, #2563eb); background: none; border: 1px solid var(--line, #e5e7eb);
		border-radius: 999px; padding: 3px 10px; cursor: pointer;
	}
	.refresh button:hover { border-color: var(--accent, #2563eb); }
	.panel { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.85em; }
	.panel input { font: inherit; padding: 5px 8px; border: 1px solid var(--line, #e5e7eb); border-radius: 6px; width: 150px; }
	.panel .go { font: inherit; padding: 5px 12px; border-radius: 6px; border: none; background: var(--accent, #2563eb); color: #fff; cursor: pointer; }
	.panel .go:disabled { opacity: 0.6; cursor: default; }
	.status { flex-basis: 100%; color: var(--muted, #6b7280); }
</style>

<div class="refresh">
	{#if generated}<span>Data updated {ago(generated)}</span>{/if}
	<button onclick={() => open = !open}>{open ? 'Close' : 'Update now'}</button>
</div>
{#if open}
	<div class="panel">
		<input type="password" placeholder="league passcode" bind:value={pass} onkeydown={(e) => e.key === 'Enter' && requestUpdate()} />
		<button class="go" onclick={requestUpdate} disabled={busy}>{busy ? 'Requesting…' : 'Request update'}</button>
		{#if status}<span class="status">{status}</span>{:else}<span class="status">Re-bakes rankings, odds, rosters, and the Oracle. Takes about 5 minutes to land.</span>{/if}
	</div>
{/if}
