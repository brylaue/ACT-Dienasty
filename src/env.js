import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	SLACK_SIGNING_SECRET: { schema: (input) => input ?? '' },
	GITHUB_DISPATCH_TOKEN: { schema: (input) => input ?? '' },
	CRON_SECRET: { schema: (input) => input ?? '' },
	REFRESH_PASSCODE: { schema: (input) => input ?? '' },
	ASK_PASSCODE: { schema: (input) => input ?? '' },
	PARLAY_CHANNEL_ID: { schema: (input) => input ?? '' },
	SLACK_BOT_TOKEN: { schema: (input) => input ?? '' },
	PARLAY_TEST_SLATE_TTL: { schema: (input) => input ?? '' },
	ANTHROPIC_API_KEY: { schema: (input) => input ?? '' },
	ANTHROPIC_MODEL: { schema: (input) => input ?? '' },
	ORACLE_LOG_WEBHOOK: { schema: (input) => input ?? '' }
});
