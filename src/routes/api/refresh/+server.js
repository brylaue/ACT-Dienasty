import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Force a league-data update: dispatches the "Update league data" GitHub
// workflow. The bake takes a few minutes, then Vercel redeploys with the
// fresh numbers. Gated by a passcode and a 10-minute cooldown so the
// league can't hammer the Actions quota.
const OWNER = 'brylaue';
const REPO = 'ACT-Dienasty';
const WORKFLOW = 'update-league-data.yml';
const BRANCH = 'master';
const COOLDOWN_MS = 10 * 60 * 1000;
let lastDispatch = 0;

export async function POST(event) {
    const token = env.GITHUB_DISPATCH_TOKEN || '';
    if (!token) {
        return json({ error: 'unconfigured', message: 'Manual updates are not set up yet (no GITHUB_DISPATCH_TOKEN).' }, { status: 503 });
    }
    const pass = env.REFRESH_PASSCODE || env.ASK_PASSCODE || '';
    if (pass) {
        const given = event.request.headers.get('x-refresh-passcode') || '';
        if (given !== pass) return json({ error: 'forbidden', message: 'Wrong passcode.' }, { status: 403 });
    }
    const now = Date.now();
    if (now - lastDispatch < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - (now - lastDispatch)) / 60000);
        return json({ error: 'cooldown', message: `An update was requested recently. Try again in about ${wait} min.` }, { status: 429 });
    }
    try {
        const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: {
                'authorization': `Bearer ${token}`,
                'accept': 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'content-type': 'application/json',
                'user-agent': 'act-dienasty-refresh',
            },
            body: JSON.stringify({ ref: BRANCH }),
        });
        if (res.status !== 204) {
            const detail = await res.text().catch(() => '');
            return json({ error: 'github', message: `GitHub refused the update (${res.status}).`, detail: detail.slice(0, 200) }, { status: 502 });
        }
        lastDispatch = now;
        return json({ ok: true, message: 'Update requested. Fresh data lands in about 5 minutes.' });
    } catch {
        return json({ error: 'upstream', message: 'Could not reach GitHub. Try again shortly.' }, { status: 502 });
    }
}
