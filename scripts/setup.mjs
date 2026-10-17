import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Install Node.js 24 LTS or newer, then run setup again.");
const cloud = process.argv.includes("--cloud");
const file = cloud ? ".env.cloud" : ".env.local";
if (!fs.existsSync(file)) {
  const template = fs
    .readFileSync(file + ".example", "utf8")
    .replace(
      "GENERATE_WITH_SETUP",
      crypto.randomBytes(48).toString("base64url"),
    );
  fs.writeFileSync(file, template, { mode: 0o600, flag: "wx" });
  console.log("Created " + file + ". This file stays private.");
} else console.log("Kept your existing " + file + ".");
fs.mkdirSync(".data", { recursive: true, mode: 0o700 });
if (cloud) {
  console.log(
    "Fill in .env.cloud, then run npm run cloud:check. Follow docs/cloud.md before deploying.",
  );
} else {
  const result = spawnSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build"],
    { stdio: "inherit", env: { ...process.env, VITE_HUB_CLOUD: "0" } },
  );
  if (result.status !== 0) {
    console.error("Build failed. Run npm ci and retry npm run setup.");
    process.exit(1);
  }
  console.log(
    "\nReady. Run npm start, then open http://127.0.0.1:3007.\nOr run npm run demo to explore fictional projects on port 3008. No accounts required.",
  );
}
