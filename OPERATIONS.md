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
`channels:read`, `channels:history`, `pins:write`, `reactions:write`,
`bookmarks:read`, `bookmarks:write`. Event
Subscriptions → Request URL `https://act-dienasty.vercel.app/api/parlay/events`,
bot event `message.channels`. If the channel ever becomes private, add
`groups:read` + `groups:history` and reinstall. Adding any scope requires
**Reinstall to Workspace**; if Slack shows a new token, update both copies.

## Workflows (`.github/workflows/`)

| Workflow | When | What |
|---|---|---|
| `update-league-data.yml` | Mon/Tue/Fri 05:37 UTC, catch-up 06:53 UTC, and the Update button | full bake: rivalry, power rankings + odds, trends ledger, tradeblock, matchups archive, knowledge pack, commentary, draft recap, Slack digest, Oracle canary. The `gate` job skips a *scheduled* run if a bake landed < 3 h ago (so the catch-up only runs when the first one failed). One run at a time. |
| `poll-commentary.yml` | every 30 min | AI lines for new trades/waivers; weekly trade re-evaluations and Roundup recaps once a week completes |
| `parlay-builder.yml` | every 15 min, all week | Parlay Builder `tick`: opener (Tue 10am ET), nag 24 h before the deadline, lock at the deadline (15 min before the first game with a leg). Idempotent — it reads the channel before posting. |
| `ci.yml` | every upload touching `src/`, `scripts/` or the manager map | site builds + Parlay tests pass. A red X means don't trust that upload. |

Crons are UTC. The bakes are pinned before 3am Eastern year-round; the Parlay
bot computes everything in Eastern time itself.

## Parlay Builder — how the week runs

- **Deadline** = **15 minutes before the kickoff of the earliest game that has
  a leg in it.** Thursday night's game if anyone has a leg in it (normally
  Thursday 8:00pm ET); if nobody does, the lock slides to the next game with a
  leg (typically Sunday 12:45pm ET). It moves as legs are added or changed, and
  the pinned board's "locks …" time (shown in each viewer's timezone) is updated
  to match. A leg the bot can't place in a game counts as the week's first game
  (earlier is the safe side). Anything posted after the lock never counts, even
  if GitHub's cron runs late. Source: ESPN's scoreboard; if it's down, Sleeper's
  kickoff feed, then Thursday 8:15pm ET.
- **Playable legs only.** A leg for a team on a bye (or a player on one), or for
  a game inside its last 15 minutes / already started, gets a ⚠️ and a one-line
  thread reply explaining why, stays off the board, and the team's earlier
  valid leg (if any) stands. Edit the message into something valid and the ⚠️
  is replaced by a ✅. Player → team uses ESPN's player search (the most
  prominent match wins when names collide); if that fails the leg is simply
  not validated.
- **Reopening an early lock.** Before the 15-minute rule the bot locked at a fixed
  6 PM. If a week *that old rule* locked turns out to have a later real cutoff (the
  legs' first game is still ahead), the next cron tick or Slack event withdraws the
  lock notice, restores the live board, removes the 🔒 marks and the bot's "too late"
  replies, and announces the new lock time (@ing everyone whose post now counts).
  Only a legacy slip qualifies — a slip the current code locked records its lock time
  in its header, so a deleted post can never reopen a week that locked properly.
  (`src/lib/server/parlayReopen.js`.) Thread replies under the board count as legs
  only when they look like a bet or a short plain pick, so feedback about the bot
  never lands on the slip.
- **Odds.** Each leg on the board / slip / lock notice shows its **DraftKings**
  price when it is a spread, total or moneyline at the posted line (ESPN's
  scoreboard carries DraftKings' lines), plus an estimated combined parlay
  price for the priced legs ("1 of 5 legs priced"). Player props, alt lines and
  "by 10" legs show n/a: DraftKings' own API blocks datacenter traffic and
  ESPN's prop feed has lines but no prices. Pricing those would need a paid odds
  API (e.g. The Odds API) and a key in Vercel + GitHub secrets.
- **Tue 10am**: opener names the placer (last week's lowest starter score) and
  the season parlay record. A pinned **board** is posted and edited in place as
  legs land (instantly via the webhook; every 15 min via cron as backstop).
- Legs: any manager just posts the bet ("Vikings ML") — team comes from
  `static/data/parlay-managers.json` (Slack user ID → Sleeper roster ID). Thread
  replies under the opener or the board count too, and `🎯 LEG | Team | leg`
  works from anyone (on-behalf entries). Latest post per team wins; the ✅ marks
  the leg that counts.
- **24 h before the deadline**: nag naming and @mentioning the missing teams.
- **Deadline**: board becomes the final 🔒 slip; the lock notice *is* the slip
  (full leg list) and @mentions the placer. Reply to that notice with **hit** /
  **miss** once it settles — that's the season record. The channel bookmark
  ("📋 Week N board" → "🔒 Week N slip") always links to the current message
  (needs `bookmarks:read` + `bookmarks:write`). The board's deadline is a Slack
  date token, so it shows in each viewer's timezone — and the webhook uses it
  to lock the week itself if the cron is late. A bet posted **after** the lock
  gets a 🔒 reaction and a thread reply that **@s the placer** ("have you
  already set the parlay? If not, it's your call - it's not on the slip") instead
  of a ✅, so silence never reads as "logged". Once the games are underway the
  reply just says it can't make the slip.
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

## Token budget (Claude API)

Everything defaults to Haiku; `ANTHROPIC_MODEL` (Vercel env + GitHub secret)
overrides it everywhere — leave it unset or on Haiku unless you want to pay
for a bigger model. The Oracle is the only heavy caller: its cached league
block is ~16K tokens for a normal question, ~33K when the question is about
rules (the full constitution is loaded only then), and the roster block is
cached across a question's rounds. The bake's post-deploy canary is a health
check that never calls the model. Bake/poll scripts only call the model for
new items (a dozen small calls a week).

## Tests

`npm test` → `scripts/test/`: parser + slate (byes, odds, lock time) unit tests, full-week scenarios replayed
from real channel fixtures (cron bot, dry run), and `webhook.e2e.mjs`, which
starts the *built* site with slack.com mocked (`mock-slack.mjs`) and posts
signed Slack events at the real webhook — board edits, ✅/🔒 reactions, thread
replies and the late-cron lock are all asserted. The e2e needs `npm run build`
first (it skips locally without one; CI builds, then tests). Add a fixture
under `scripts/test/fixtures/` when a new situation bites.

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
