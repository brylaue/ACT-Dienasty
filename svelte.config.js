import vercel from "@sveltejs/adapter-vercel";
import node from "@sveltejs/adapter-node";

const dockerBuild = process.env.DOCKER_BUILD;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: dockerBuild ? node() : vercel({
      // Let Vercel auto-detect the Node.js version
      regions: ['iad1']
    }),
  },
};

export default config;
