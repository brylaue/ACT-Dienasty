import { env } from '$env/dynamic/private';
import { waitUntil } from '@vercel/functions';
import crypto from 'node:crypto';

/*
  /oracle slash command for the league Slack.

  Setup (one time, by Bryan):
  1. api.slack.com/apps → Create App → From scratch → pick the league workspace
  2. Slash Commands → Create: command "/oracle",
     Request URL https://act-dienasty.vercel.app/api/slack
  3. Basic Information → copy the Signing Secret
  4. Vercel → Settings → Environment Variables → SLACK_SIGNING_SECRET → redeploy
  5. Install the app to the workspace

  Slack demands a response within 3 seconds; the Oracle thinks longer than
  that, so we ack instantly and deliver the real answer to response_url
  once it is ready (visible to the whole channel).

  Usage: /oracle when is the trade deadline
         /oracle as Immigrants: what do my taxi players cost to claim
*/

const verifySlack = (secret, timestamp, rawBody, signature) => {
  if (!secret || !timestamp || !signature) return false;
  // reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
};

export async function POST(event) {
  const secret = env.SLACK_SIGNING_SECRET;
  if (!secret) {
    return new Response('Slack integration not configured (SLACK_SIGNING_SECRET missing).', { status: 503 });
  }

  const rawBody = await event.request.text();
  const ok = verifySlack(
    secret,
    event.request.headers.get('x-slack-request-timestamp'),
    rawBody,
    event.request.headers.get('x-slack-signature')
  );
  if (!ok) return new Response('invalid signature', { status: 401 });

  const params = new URLSearchParams(rawBody);
  const text = (params.get('text') || '').trim();
  const responseUrl = params.get('response_url');
  const userName = params.get('user_name') || 'someone';

  if (!text) {
    return Response.json({
      response_type: 'ephemeral',
      text: 'Ask me something: `/oracle when is the trade deadline`\nSpeak as your team with `/oracle as Immigrants: what do my picks look like`',
    });
  }

  // optional "as TeamName:" prefix carries team context
  let team = '';
  let question = text;
  const asMatch = text.match(/^as\s+(.+?):\s*(.+)$/i);
  if (asMatch) {
    team = asMatch[1].trim().slice(0, 60);
    question = asMatch[2].trim();
  }

  // answer asynchronously - Slack gets the ack now, the answer when ready
  const deliver = async () => {
    let answer = 'The Oracle came back empty-handed. Try rephrasing?';
    try {
      const res = await event.fetch('/api/ask', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-oracle-internal': secret,
        },
        body: JSON.stringify({ question: question.slice(0, 300), team }),
      });
      const data = await res.json();
      answer = data.answer || data.message || answer;
    } catch {
      answer = 'The Oracle is having a moment. Try again shortly.';
    }
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        text: `*${userName} asked:* ${question}\n\n🔮 ${answer}`,
      }),
    }).catch(() => {});
  };
  waitUntil(deliver());

  return Response.json({
    response_type: 'ephemeral',
    text: '🔮 Consulting the Oracle…',
  });
}
