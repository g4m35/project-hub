import fs from "node:fs";
import path from "node:path";
import { cloudConfig } from "./config.mjs";
const checks = [];
checks.push([
  Number(process.versions.node.split(".")[0]) >= 24,
  "Node.js 24 or newer",
]);
checks.push([
  fs.existsSync("node_modules/vite"),
  "Dependencies installed (npm ci)",
]);
if (process.argv.includes("--cloud")) {
  try {
    cloudConfig();
    checks.push([true, "Required cloud settings are valid (values hidden)"]);
  } catch (error) {
    checks.push([false, error.message]);
  }
} else {
  checks.push([
    fs.existsSync("dist/index.html"),
    "Frontend built (npm run setup)",
  ]);
  const dir = path.resolve(process.env.HUB_DATA_DIR || ".data");
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.accessSync(dir, fs.constants.W_OK);
    checks.push([true, "Local data directory is writable"]);
  } catch {
    checks.push([false, "Local data directory is not writable"]);
  }
  console.log(
    "Chat reading: " +
      (process.env.HUB_ENABLE_CHATS === "1"
        ? "enabled by your configuration"
        : "off (opt in with HUB_ENABLE_CHATS=1)"),
  );
}
for (const [ok, label] of checks) console.log((ok ? "PASS " : "FAIL ") + label);
if (checks.some(([ok]) => !ok)) process.exitCode = 1;
