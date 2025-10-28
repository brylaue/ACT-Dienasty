import vercel from "@sveltejs/adapter-vercel";
import node from "@sveltejs/adapter-node";

const dockerBuild = process.env.DOCKER_BUILD;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: dockerBuild ? node() : vercel({
      runtime: 'nodejs20.x',
      // Support for both Node.js 20 and 22
      regions: ['iad1']
    }),
  },
};

export default config;
