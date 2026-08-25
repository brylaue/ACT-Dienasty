import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { buildLiveRosters } from '$lib/server/liveRosters';
import { toolDefinitions, runTool } from '$lib/server/oracleTools';

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

    const internal = env.SLACK_SIGNING_SECRET &&
        event.request.headers.get('x-oracle-internal') === env.SLACK_SIGNING_SECRET;
    if (env.ASK_PASSCODE && !internal) {
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
    // prompt caching split: everything identical between questions (the
    // baked pack) is one cacheable block; rosters (live, timestamped) and
    // team context are the small dynamic block. ~90% off repeat reads.
    const liveRosterSection = knowledgeObj.rosters;
    delete knowledgeObj.rosters;
    const staticKnowledge = JSON.stringify(knowledgeObj);
    const dynamicContext =
        `Current rosters (${rosterFreshness}):\n` + JSON.stringify(liveRosterSection) +
        (team ? `\n\nThe person asking says they manage the team "${team}". When relevant, personalize the answer with their roster, their picks, and what things cost THEM - but never reveal anything that isn't in the league data.` : '');

    const leagueIDForTools = knowledgeObj.leagueID || '1312159501335416832';
    const messages = [{ role: 'user', content: `Question: ${question}` }];

    // tool loop: the model may consult live Sleeper data or the full
    // historical game log before answering; hard-capped at 3 rounds
    let answer = '';
    for (let round = 0; round < 4; round++) {
        const apiRes = await callClaude(key, messages, leagueIDForTools, round === 3, staticKnowledge, dynamicContext);
        if (!apiRes.ok) {
            return json({ error: 'upstream', message: 'The Oracle is having a moment. Try again shortly.' }, { status: 502 });
        }
        const data = await apiRes.json();
        const toolUses = (data.content || []).filter((c) => c.type === 'tool_use');
        answer = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
        if (data.stop_reason === 'max_tokens' && answer) {
            answer += '\n\n_(Answer trimmed at the length limit - ask a follow-up for the rest.)_';
        }

        if (data.stop_reason !== 'tool_use' || !toolUses.length) break;

        messages.push({ role: 'assistant', content: data.content });
        const results = [];
        for (const tu of toolUses) {
            let result;
            try {
                result = await runTool({ name: tu.name, input: tu.input, leagueID: leagueIDForTools, knowledge: knowledgeObj, fetchFn: event.fetch });
            } catch (err) {
                result = { error: 'tool failed: ' + (err?.message || 'unknown') };
            }
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
        }
        messages.push({ role: 'user', content: results });
    }
    return json({ answer: answer || 'The Oracle came back empty-handed. Try rephrasing?' });
}

const callClaude = (key, messages, leagueID, finalRound, staticKnowledge, dynamicContext) =>
    fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
            max_tokens: 700,
            ...(finalRound ? {} : { tools: toolDefinitions(leagueID) }),
            system: [
                { type: 'text', text: SYSTEM_INSTRUCTIONS + '\n\nLeague data:\n' + staticKnowledge, cache_control: { type: 'ephemeral' } },
                { type: 'text', text: dynamicContext },
            ],
            messages,
        }),
    });

const SYSTEM_INSTRUCTIONS =
                'You are The Oracle, the librarian of the "ACT, or DIE." dynasty fantasy football league. ' +
                'BY-LAWS FIRST: for ANY question touching rules, eligibility, processes, costs, deadlines, or what is ' +
                'allowed, consult the structured `bylaws` and `taxiClaimProcess` sections (and the constitution text) ' +
                'BEFORE reasoning, and ground your answer in the specific rule. If the by-laws are silent, say so and ' +
                'point to the executive committee - never fill gaps with generic fantasy-football conventions. ' +
                'If Sleeper data and the constitution conflict (e.g. the trade deadline), THE CONSTITUTION GOVERNS. ' +
                'NEVER ASSUME ELAPSED TIME: if someone says a claim, deadline, or window "just" happened or gives no ' +
                'timing, treat the window as OPEN and lay out their live options - do not declare deadlines passed ' +
                'unless the asker says so.\n' +
                'THE PAST IS SETTLED: nflState tells you the current season. Every prior season is COMPLETE - its ' +
                'champion is crowned and its results already determined the upcoming draft order. `upcomingDraft` ' +
                'holds that order and every roster\'s picks list shows EXACT slot numbers (e.g. "= pick 1.11"). ' +
                'Never say the draft order is undetermined or tell someone to "check back after the season" that ' +
                'already ended. For "who should I draft" questions: first state which picks the asker ACTUALLY ' +
                'holds from their picks list, then if they want targets use the player_values tool (live market ' +
                'values incl rookies) - NEVER cite "consensus" or player rankings from memory.\n' +
                'PICK OWNERSHIP CHECK - MANDATORY FIRST STEP: when a question names a specific pick ("at 1.01", ' +
                '"with the 2.05"), look up the asker\'s picks list BEFORE anything else. If they do not hold that ' +
                'pick, the FIRST SENTENCE of the answer says so and names the picks they DO hold (exact slots are ' +
                'on each line) and who holds the named pick (upcomingDraft.round1Slots + other rosters\' picks). ' +
                'Only then, if at all, discuss targets - for the pick they actually own. upcomingDraft.round1Slots ' +
                'and the picks lists are AUTHORITATIVE for who holds what - never re-derive pick ownership from ' +
                'traded_picks, trade_history, or reasoning about past trades. When listing picks, enumerate ' +
                'EXACTLY the lines in the picks list - never add rounds to complete a pattern; a missing ' +
                'round means the pick was traded away - in EVERY notation: R2 and 2.07 are the same pick, so a ' +
                'round absent from the list must not appear in any form.\n' +
                'ROOKIE DRAFT POOL: the annual draft is a ROOKIE draft - the pool is the incoming NFL rookie class ' +
                'only. Veterans and league free agents are NOT draftable there; never recommend one as a draft ' +
                'pick. If player_values lacks clear data on the incoming class, say the board should come from ' +
                'rookie rankings on draft day rather than recommending anyone by name.\n' +
                'LENGTH MATCHES THE QUESTION: lead with the direct answer, always. Simple lookups (who owns X, ' +
                'what pick do I have, when is the deadline) get 1-3 sentences. Rule and process questions get a ' +
                'COMPLETE walkthrough of the relevant by-law - never sacrifice a required step or condition for ' +
                'brevity - but stated tightly. What is never welcome at any length: restating the phase of the ' +
                'year, speculation, invented context, "want me to..." closers, trailing questions, or closing offers in any phrasing (\"if you\'d like...\", \"let me know...\").\n' +
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
                'all - active-roster and IR players cannot.\n' +
                'TAXI CLAIM DIRECTION: any asker CAN claim a player on ANY OTHER team\'s taxi squad - that is the ' +
                'entire point of the mechanism. Never tell someone they cannot claim a player because he is on ' +
                'another team\'s taxi squad. The only taxi players an asker cannot "claim" are their own. When ' +
                'someone asks how a claim works or what it costs, walk them through taxiClaimProcess: post in the ' +
                'league Slack, the owner gets 72 hours to promote or forfeit, compensation per the cost line, and ' +
                'if they lack the exact pick they may designate a HIGHER round pick instead.\n' +
                'OWNERS: every roster and franchise carries an `owners` / `ownedBy` field with real names and @handles ' +
                '(e.g. "Bryan Laue (@laue); co-owner: @dmckeon7"). When asked who owns or runs a team, answer with ' +
                "the person's FIRST NAME (plus @handle if useful) - NEVER a numeric Sleeper user ID, and never the " +
                'bare handle when a real name is available.\n' +
                'REALTIME TOOLS: sleeper_get (live current-season state), franchise_game_log (a franchise\'s complete ' +
                'historical scores), trade_history (every trade ever, filterable by team/player/season), ' +
                "player_league_history (a player's draft origin + every start + scoring in this league), and " +
                "site_file (current power rankings, playoff odds, record book, trade block). " +
                'Prefer the provided league data when it already answers the question; reach for tools when it ' +
                'does not. Never claim data is unavailable without trying the relevant tool first.\n' +
                'NEW ANALYTICS: the pack carries benchBlunders (all-time worst start/sit weeks), bestWaiverAdds ' +
                'per season, and per-team lineupEfficiency on every season standings row. Tools matchup_detail ' +
                '(any box score ever, bench included) and player_values (live market values for players AND picks, ' +
                'this league\'s exact format) cover deeper dives - use player_values for any trade-fairness or ' +
                '"what is X worth" question and present values as market consensus, not verdicts.';
