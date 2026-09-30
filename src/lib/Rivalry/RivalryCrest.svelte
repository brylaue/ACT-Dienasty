<script>
    // The rivalry hero: two medallions (the chosen teams' avatars) facing off
    // across a lightning split, with the head-to-head record underneath.
    // Idle (no teams yet) shows monoline helmets and an invitation.
    export let one = null;      // { name, avatar }
    export let two = null;
    export let record = null;   // { one, two } regular-season wins
    export let loading = false;
    import { onMount } from "svelte";
    let narrow = false; // phones: bigger type inside the artwork, shorter names
    onMount(() => { const mq = matchMedia("(max-width: 600px)"); narrow = mq.matches; const h = (e) => (narrow = e.matches); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); });

    const trim = (s, n = 22) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
    $: caption = loading ? "Analyzing the rivalry…" : record ? "HEAD TO HEAD" : one && two ? "" : "Pick two teams to settle it";
    $: score = record ? `${record.one} – ${record.two}` : "";
</script>

<svg class="crest" viewBox="0 0 1200 560" role="img" aria-label={one && two ? `${one.name} versus ${two.name}` : "Rivalry"}>
    <defs>
        <radialGradient id="rc-bg" cx="50%" cy="42%" r="70%">
            <stop offset="0%" stop-color="#1a355f" />
            <stop offset="55%" stop-color="#0c1a33" />
            <stop offset="100%" stop-color="#050912" />
        </radialGradient>
        <linearGradient id="rc-steel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f4f7fb" />
            <stop offset="35%" stop-color="#9aa7b8" />
            <stop offset="60%" stop-color="#e6ebf2" />
            <stop offset="100%" stop-color="#6f7c8e" />
        </linearGradient>
        <linearGradient id="rc-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffe9a3" />
            <stop offset="50%" stop-color="#f5b400" />
            <stop offset="100%" stop-color="#b47a00" />
        </linearGradient>
        <radialGradient id="rc-light" cx="50%" cy="0%" r="70%">
            <stop offset="0%" stop-color="rgba(255,244,214,0.55)" />
            <stop offset="60%" stop-color="rgba(255,244,214,0.08)" />
            <stop offset="100%" stop-color="rgba(255,244,214,0)" />
        </radialGradient>
        <filter id="rc-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="10" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="rc-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="18" />
        </filter>
        <clipPath id="rc-clip-one"><circle cx="300" cy="250" r="140" /></clipPath>
        <clipPath id="rc-clip-two"><circle cx="900" cy="250" r="140" /></clipPath>
    </defs>

    <!-- night sky + stadium lights -->
    <rect width="1200" height="560" fill="url(#rc-bg)" />
    <ellipse cx="120" cy="0" rx="380" ry="220" fill="url(#rc-light)" />
    <ellipse cx="1080" cy="0" rx="380" ry="220" fill="url(#rc-light)" />

    <!-- gridiron in perspective -->
    <g stroke="rgba(255,255,255,0.10)" stroke-width="2" fill="none">
        <line x1="0" y1="330" x2="1200" y2="330" stroke="rgba(255,255,255,0.22)" />
        <line x1="0" y1="352" x2="1200" y2="352" />
        <line x1="0" y1="380" x2="1200" y2="380" />
        <line x1="0" y1="416" x2="1200" y2="416" />
        <line x1="0" y1="462" x2="1200" y2="462" />
        <line x1="0" y1="518" x2="1200" y2="518" />
        <line x1="600" y1="330" x2="600" y2="560" stroke="rgba(255,255,255,0.18)" />
        <line x1="520" y1="330" x2="380" y2="560" />
        <line x1="440" y1="330" x2="160" y2="560" />
        <line x1="360" y1="330" x2="-60" y2="560" />
        <line x1="680" y1="330" x2="820" y2="560" />
        <line x1="760" y1="330" x2="1040" y2="560" />
        <line x1="840" y1="330" x2="1260" y2="560" />
    </g>
    <rect x="0" y="330" width="1200" height="230" fill="url(#rc-bg)" opacity="0.35" />

    <!-- the split -->
    <polygon points="640,-10 566,214 622,206 528,570 612,296 560,306" fill="#f5b400" opacity="0.55" filter="url(#rc-soft)" />
    <polygon class="bolt" points="640,-10 566,214 622,206 528,570 612,296 560,306" fill="url(#rc-gold)" filter="url(#rc-glow)" />
    <polygon points="634,10 585,205 620,201 552,520 600,300 574,303" fill="#fff8dc" opacity="0.65" />

    <!-- medallions -->
    {#each [[300, one, "rc-clip-one"], [900, two, "rc-clip-two"]] as [cx, team, clip]}
        <g>
            <circle cx={cx} cy="250" r="168" fill="rgba(0,0,0,0.35)" filter="url(#rc-soft)" />
            <circle cx={cx} cy="250" r="158" fill="#0b1426" stroke="url(#rc-steel)" stroke-width="12" />
            <circle cx={cx} cy="250" r="146" fill="none" stroke="#f5b400" stroke-width="3" opacity="0.9" />
            {#if team?.avatar}
                <image href={team.avatar} x={cx - 140} y="110" width="280" height="280" clip-path={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
                <circle cx={cx} cy="250" r="140" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="6" />
            {:else}
                <!-- monoline football -->
                <g transform={`translate(${cx} 250) rotate(-32)`} fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
                    <ellipse rx="96" ry="58" />
                    <path d="M-84 -18 C-40 -50 40 -50 84 -18 M-84 18 C-40 50 40 50 84 18" opacity="0.45" stroke-width="5" />
                    <path d="M-40 0 H40 M-26 -13 V13 M-9 -13 V13 M9 -13 V13 M26 -13 V13" />
                </g>
            {/if}
            <text x={cx} y="450" text-anchor="middle" class="name" class:muted={!team}>{team ? trim(team.name, narrow ? 16 : 22) : "Select a team"}</text>
        </g>
    {/each}

    <!-- VS badge -->
    <polygon points="600,196 648,224 648,280 600,308 552,280 552,224" fill="#0b1426" stroke="url(#rc-gold)" stroke-width="5" />
    <text x="600" y="266" text-anchor="middle" class="vs">VS</text>

    <!-- caption / record -->
    {#if caption}<text x="600" y={score ? "500" : "520"} text-anchor="middle" class="caption">{caption}</text>{/if}
    {#if score}<text x="600" y="545" text-anchor="middle" class="score">{score}</text>{/if}
</svg>

<style>
    .crest { display: block; width: 100%; height: auto; border-radius: 18px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35); }
    .name { font-family: -apple-system, "Inter", "Segoe UI", Roboto, sans-serif; font-size: 34px; font-weight: 800; fill: #ffffff; letter-spacing: -0.01em; }
    .name.muted { fill: rgba(255, 255, 255, 0.45); font-weight: 600; }
    .vs { font-family: -apple-system, "Inter", "Segoe UI", Roboto, sans-serif; font-size: 40px; font-weight: 900; fill: #ffffff; letter-spacing: 0.02em; }
    .caption { font-family: -apple-system, "Inter", "Segoe UI", Roboto, sans-serif; font-size: 20px; font-weight: 700; fill: rgba(255, 255, 255, 0.7); letter-spacing: 0.22em; }
    .score { font-family: -apple-system, "Inter", "Segoe UI", Roboto, sans-serif; font-size: 44px; font-weight: 900; fill: #ffe9a3; }
    .bolt { animation: flicker 6s ease-in-out infinite; transform-origin: center; }
    @keyframes flicker { 0%, 100% { opacity: 1; } 47% { opacity: 1; } 50% { opacity: 0.55; } 53% { opacity: 1; } 78% { opacity: 0.85; } }
    @media (prefers-reduced-motion: reduce) { .bolt { animation: none; } }
    @media (max-width: 600px) {
        .name { font-size: 50px; }
        .vs { font-size: 50px; }
        .caption { font-size: 30px; letter-spacing: 0.12em; }
        .score { font-size: 66px; }
        .crest { border-radius: 12px; }
    }
</style>
