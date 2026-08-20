import vercel from "@sveltejs/adapter-vercel";


/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: vercel({
      runtime: 'nodejs22.x', // nodejs20.x hit end-of-life April 2026; Vercel retires EOL runtimes
      regions: ['iad1']
    }),
  },
};

export default config;
