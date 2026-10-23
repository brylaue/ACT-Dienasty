import vercel from "@sveltejs/adapter-vercel";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: vercel({
        runtime: "nodejs24.x", // Node 24 is the current LTS (package.json engines); older runtimes get retired by Vercel
        regions: ["iad1"],
      }),
      csrf: {
        // Slack slash commands POST form-encoded from slack.com with no Origin header, so SvelteKit's
        // origin check would 403 them before our handler runs. "*" turns that check off. Safe here: this
        // site sets no auth cookies (CSRF's threat model), and /api/slack and /api/parlay/events verify
        // Slack's HMAC signature, which is stronger than an origin check.
        trustedOrigins: ["*"],
      },
    }),
  ],
});
