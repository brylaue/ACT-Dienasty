<script>
	import { onMount } from 'svelte';
	let conditions = [];
	onMount(async () => {
		try {
			const r = await fetch('/data/pick-conditions.json');
			if (r.ok) conditions = (await r.json()).conditions || [];
		} catch { /* nothing recorded */ }
	});
</script>

<style>
	.conditions { max-width: 720px; margin: 0 auto 28px; padding: 0 16px; }
	.card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px 20px; background: #fff; }
	.card + .card { margin-top: 12px; }
	.title { font-weight: 700; font-size: 1.02em; margin: 0 0 4px; }
	.held { color: #6b7280; font-size: 0.92em; margin: 0 0 10px; }
	.rule { margin: 0 0 10px; line-height: 1.5; }
	.reqs { margin: 0; padding-left: 20px; line-height: 1.5; color: #374151; font-size: 0.94em; }
	.src { color: #9ca3af; font-size: 0.82em; margin: 10px 0 0; }
</style>

{#if conditions.length}
	<div class="conditions">
		{#each conditions as c}
			<div class="card">
				<p class="title">Protected pick: {c.pick}</p>
				<p class="held">Held by {c.heldBy}</p>
				<p class="rule">{c.rule}</p>
				<ul class="reqs">
					{#each c.requirements as r}<li>{r}</li>{/each}
				</ul>
				<p class="src">Ruling: {c.source}</p>
			</div>
		{/each}
	</div>
{/if}
