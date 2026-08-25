import vercel from "@sveltejs/adapter-vercel";


/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Slack slash commands POST form-encoded from slack.com - SvelteKit's
    // origin check would 403 them before our handler runs. Safe to disable:
    // this site sets no auth cookies (CSRF's threat model), and /api/slack
    // verifies Slack's HMAC signature, which is stronger than origin checks.
    csrf: { checkOrigin: false },
    adapter: vercel({
      runtime: 'nodejs22.x', // nodejs20.x hit end-of-life April 2026; Vercel retires EOL runtimes
      regions: ['iad1']
    }),
  },
};

export default config;
