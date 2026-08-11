import vercel from "@sveltejs/adapter-vercel";
import node from "@sveltejs/adapter-node";

const dockerBuild = process.env.DOCKER_BUILD;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: dockerBuild ? node() : vercel({
      runtime: 'nodejs22.x', // nodejs20.x hit end-of-life April 2026; Vercel retires EOL runtimes
      regions: ['iad1']
    }),
  },
};

export default config;
