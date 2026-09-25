# ACT, or DIE. — operations runbook

The site (act-dienasty.vercel.app) is a SvelteKit app on Vercel. All of its
league data is baked by GitHub Actions and committed to `static/data/`; the
Parlay Builder is a Slack bot run by GitHub Actions plus a webhook on the site.
Deploys happen automatically on every commit to `master`.

## Where the secrets live

| Secret | GitHub Actions secret | Vercel env var | Used by |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | yes | AI blurbs, commentary, recaps, The Oracle (`/api/ask`) |
| `GITHUB_DISPATCH_TOKEN` | — | yes | the site's **Update now** button (`/api/refresh` → workflow dispatch) |
| `SLACK_BOT_TOKEN` (`xoxb-…`) | yes | yes | Parlay Builder cron **and** the instant webhook — **update both** if it ever rotates |
| `SLACK_SIGNING_SECRET` | — | yes | verifies Slack's webhook requests (`/api/parlay/events`) |

Slack app "Parlay Builder" (api.slack.com/apps). Bot scopes: `chat:write`,
`channels:read`, `channels:history`, `pins:write`, `reactions:write`. Event
Subscriptions → Request URL `https://act-dienasty.vercel.app/api/parlay/events`,
bot event `message.channels`. If the channel ever becomes private, add
`groups:read` + `groups:history` and reinstall. Adding any scope requires
**Reinstall to Workspace**; if Slack shows a new token, update both copies.

## Workflows (`.github/workflows/`)

| Workflow | When | What |
|---|---|---|
| `update-league-data.yml` | Mon/Tue/Fri 05:37 UTC, catch-up 06:53 UTC, and the Update button | full bake: rivalry, power rankings + odds, trends ledger, tradeblock, matchups archive, knowledge pack, commentary, draft recap, Slack digest, Oracle canary. The `gate` job skips a *scheduled* run if a bake landed < 3 h ago (so the catch-up only runs when the first one failed). One run at a time. |
| `poll-commentary.yml` | every 30 min | AI lines for new trades/waivers; weekly trade re-evaluations and Roundup recaps once a week completes |
| `parlay-builder.yml` | every 15 min Tue–Thu | Parlay Builder `tick`: opener (Tue 10am ET), nag 24 h before the deadline, lock at the deadline. Idempotent — it reads the channel before posting. |
| `ci.yml` | every upload touching `src/`, `scripts/` or the manager map | site builds + Parlay tests pass. A red X means don't trust that upload. |

Crons are UTC. The bakes are pinned before 3am Eastern year-round; the Parlay
bot computes everything in Eastern time itself.

## Parlay Builder — how the week runs

- **Deadline** = 2 h before the week's first kickoff (Sleeper's schedule feed,
  ESPN fallback), capped at **Thursday 6pm ET**. Thanksgiving → Thursday 11am.
- **Tue 10am**: opener names the placer (last week's lowest starter score) and
  the season parlay record. A pinned **board** is posted and edited in place as
  legs land (instantly via the webhook; every 15 min via cron as backstop).
- Legs: any manager just posts the bet ("Vikings ML") — team comes from
  `static/data/parlay-managers.json` (Slack user ID → Sleeper roster ID). Thread
  replies under the opener or the board count too, and `🎯 LEG | Team | leg`
  works from anyone (on-behalf entries). Latest post per team wins; the ✅ marks
  the leg that counts.
- **24 h before the deadline**: nag naming and @mentioning the missing teams.
- **Deadline**: board becomes the final 🔒 slip; a lock notice pings the placer.
  Reply to that notice with **hit** / **miss** once it settles — that's the
  season record.
- **Talk to it**: `@Parlay Builder …` or "hey parlay builder, …" in the
  channel. It answers in a thread: *who's missing?*, *status*, *deadline?*,
  *who's placing?*, *record?*, *my leg?*, *help*. "hey parlay builder, Vikings
  ML" logs the leg. It also explains its own rules ("can I change my pick?",
  "what if I forget?", "how do I report a hit?", "how does this work?").
  League questions (history, bylaws, trades, drafts…) are handed to The
  Oracle on the site and the answer posted in the thread; anything else gets
  a short deadpan quip via Claude (rules-only, no facts/picks/personal info).
  A gripe that merely mentions it gets no reply; a question that mentions
  "the bot" does. Oracle hand-offs count against `/api/ask`'s rate limit.
- Stops at the league's playoff week (one sign-off), resumes next September.

Manual runs: Actions → *Parlay Builder bot* → Run workflow → `tick` (safe, does
only what's due) or `open` / `nag` / `compile` (post that step now). Use the
`channel` input to test in a private channel.

Local dry runs never touch Slack:
`node scripts/parlay-bot.mjs tick --dry` (fixture data, clearly labelled).
Test hooks: `PARLAY_TEST_NOW=<epoch ms>`, `PARLAY_TEST_FIXTURE=<json>`.

## Tests

`npm test` → `scripts/test/` (parser unit tests + full-week scenarios replayed
from real channel fixtures). CI runs them on every upload. Add a fixture under
`scripts/test/fixtures/` when a new situation bites.

## Curated data (never overwritten by bakes)

- `static/data/parlay-managers.json` — Slack user → roster. Update when a
  franchise changes hands or a new co-owner joins Slack.
- `static/data/pick-conditions.json` — pick protections / trade conditions.
- `static/data/comp-picks.json` — Toilet Bowl 1.13 history (add each year).
- `static/data/oracle-faq.json` — learned Oracle rulings.
- `static/data/slack-archive.json` — The Vault (redacted at write time).

## August rollover checklist

1. Sleeper creates the new-season league → put its ID in
   `src/lib/utils/leagueInfo.js` (the site depends on it; the Parlay bot follows
   the chain on its own but logs a reminder).
2. Re-check `parlay-managers.json` for ownership changes.
3. Add last season's comp 1.13 to `comp-picks.json`; add draft-day picks
   protections to `pick-conditions.json` if any.
4. Press **Update now** once and confirm the home page, power rankings and
   Oracle look right for the new season.
5. First Parlay week: Sleeper flips to "regular season" the Wednesday before
   kickoff, so that one week the opener posts Wednesday.

## Uploading changes

GitHub web UI → **Add file → Upload files**. Anything under `.github/` must be
uploaded by **dragging the folder** (single-file upload silently skips workflow
files). Wait for CI to go green.
