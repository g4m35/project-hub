import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build"],
  { stdio: "inherit", env: { ...process.env, VITE_HUB_CLOUD: "1" } },
);
process.exitCode = result.status || (result.error ? 1 : 0);
