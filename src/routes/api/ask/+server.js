import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { buildLiveRosters } from '$lib/server/liveRosters';

/*
  The Oracle's AI half: answers questions using only the baked league
  knowledge pack. Requires ANTHROPIC_API_KEY in Vercel env vars; without
  it the endpoint declines politely and the page's local search still
  works. Optional ASK_PASSCODE env var gates the endpoint for
  league-members-only use.
*/

// best-effort per-instance rate limit (serverless instances are
// ephemeral, so this is a speed bump, not a wall)
const hits = new Map();
const allow = (ip) => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    if (arr.length >= 8) return false;
    arr.push(now);
    hits.set(ip, arr);
    return true;
};

export async function POST(event) {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) {
        return json({ error: 'unconfigured', message: 'The Oracle is asleep (no API key configured).' }, { status: 503 });
    }

    if (env.ASK_PASSCODE) {
        const provided = event.request.headers.get('x-ask-passcode') || '';
        if (provided !== env.ASK_PASSCODE) {
            return json({ error: 'passcode', message: 'League passcode required.' }, { status: 401 });
        }
    }

    if (!allow(event.getClientAddress())) {
        return json({ error: 'rate', message: 'Easy — a few questions a minute, tops.' }, { status: 429 });
    }

    let question = '';
    let team = '';
    try {
        const body = await event.request.json();
        question = String(body?.question || '').trim().slice(0, 300);
        // optional self-identified team: context only, sanitized hard
        team = String(body?.team || '').replace(/[\n\r{}<>]/g, '').trim().slice(0, 60);
    } catch { /* falls through to the empty-question check */ }
    if (!question) {
        return json({ error: 'empty', message: 'Ask an actual question.' }, { status: 400 });
    }

    const kRes = await event.fetch('/data/knowledge.json');
    if (!kRes.ok) {
        return json({ error: 'nodata', message: 'Knowledge pack missing.' }, { status: 500 });
    }
    const knowledgeObj = await kRes.json();

    // roster/taxi/pick questions deserve LIVE data, not last Tuesday's -
    // rebuild that section from Sleeper right now; fall back to the bake
    let rosterFreshness = `as of the weekly refresh (${knowledgeObj.generated})`;
    try {
        const leagueID = knowledgeObj.leagueID || '1312159501335416832';
        knowledgeObj.rosters = await buildLiveRosters({ leagueID, knowledge: knowledgeObj, fetchFn: event.fetch });
        rosterFreshness = 'LIVE from Sleeper as of this very question';
    } catch { /* baked rosters remain in place */ }
    // endpoint-only helpers - the live layer has already folded these
    // into the roster lines, so they'd just burn tokens in the prompt
    delete knowledgeObj.draftedBy;
    delete knowledgeObj.claimCosts;
    const knowledge = `(Roster, taxi-squad, and draft-pick data below is ${rosterFreshness}.)\n` + JSON.stringify(knowledgeObj);

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system:
                'You are The Oracle, the librarian of the "ACT, or DIE." dynasty fantasy football league. ' +
                'Answer questions using ONLY the league data provided. Be concise (a few sentences), specific ' +
                '(years, records, point totals), and a little wry. If the data does not contain the answer, say so ' +
                'plainly rather than guessing. Never invent stats.\n' +
                'ROSTER STATUS IS A LOOKUP, NOT A DEDUCTION. Every team in the rosters section has separate ' +
                'activeRoster, taxiSquad, injuredReserve and picks lists. Before saying where any player sits, find ' +
                'the exact list he appears in and answer from that. Never state or imply that a player is on the ' +
                'active roster because you did not notice him on the taxi squad - search the taxiSquad lists first. ' +
                'Check the player name character by character: this league has had two Etiennes, two Harrisons, and ' +
                'assorted juniors.\n' +
                'TAXI CLAIM COSTS: each taxiSquad entry already carries its TAXI CLAIM COST. Quote that number ' +
                'verbatim instead of re-deriving it from the constitution, and note whether the asking team owns a ' +
                'pick of the required round in its picks list. Only players in a taxiSquad list can be claimed at ' +
                'all - active-roster and IR players cannot.',
            messages: [{
                role: 'user',
                content: `League data:\n${knowledge}\n\n${team ? `The person asking says they manage the team "${team}". When relevant, personalize the answer with their roster, their picks, and what things cost THEM - but never reveal anything that isn't in the league data.\n\n` : ''}Question: ${question}`,
            }],
        }),
    });

    if (!apiRes.ok) {
        return json({ error: 'upstream', message: 'The Oracle is having a moment. Try again shortly.' }, { status: 502 });
    }
    const data = await apiRes.json();
    const answer = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    return json({ answer });
}
