import { GITHUB_DISPATCH_TOKEN, CRON_SECRET } from '$app/env/private';

// Reliable heartbeat for the Parlay Builder. GitHub's own cron drifts (gaps of
// 2.5-6h in practice), so an external clock - Vercel Cron or a free pinger like
// cron-job.org - calls this every 15 min and it dispatches the bot's workflow
// in "tick" mode. The bot only does what's due and the workflow runs one at a
// time, so extra or overlapping calls are harmless.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this itself)
// or `?key=<CRON_SECRET>` for pingers that can't set headers.
const OWNER = 'brylaue';
const REPO = 'ACT-Dienasty';
const WORKFLOW = 'parlay-builder.yml';
const BRANCH = 'master';

export async function GET({ request, url }) {
    if (!CRON_SECRET || !GITHUB_DISPATCH_TOKEN) {
        return Response.json({ error: 'unconfigured', need: [!CRON_SECRET && 'CRON_SECRET', !GITHUB_DISPATCH_TOKEN && 'GITHUB_DISPATCH_TOKEN'].filter(Boolean) }, { status: 503 });
    }
    const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('key') || '';
    if (given !== CRON_SECRET) return Response.json({ error: 'forbidden' }, { status: 403 });

    try {
        const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'content-type': 'application/json',
                'user-agent': 'act-dienasty-parlay-tick',
            },
            body: JSON.stringify({ ref: BRANCH, inputs: { mode: 'tick' } }),
        });
        if (res.status !== 204) return Response.json({ error: 'github', status: res.status, detail: (await res.text().catch(() => '')).slice(0, 200) }, { status: 502 });
        return Response.json({ ok: true, dispatched: 'tick' });
    } catch {
        return Response.json({ error: 'upstream' }, { status: 502 });
    }
}
