// npm test - runs every suite and fails if any does
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of ["parlay-core.test.mjs", "parlay-bot.scenarios.mjs"]) {
  console.log(`\n▶ ${f}`);
  const r = spawnSync("node", [join(here, f)], { stdio: "inherit", timeout: 300000 });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
