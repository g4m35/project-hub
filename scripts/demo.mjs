import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, ".data/demo");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, "hub.json");
if (!fs.existsSync(file))
  fs.copyFileSync(path.join(root, "examples/demo-state.json"), file);
fs.chmodSync(file, 0o600);
if (!fs.existsSync(path.join(root, "dist/index.html")))
  throw new Error("Run npm run setup first.");
console.log(
  "Fictional demo only. Provider calls and chat reads are disabled; your normal hub data is separate.",
);
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: process.env.PORT || "3008",
    HUB_DATA_DIR: dir,
    HUB_PROJECT_ROOTS: path.join(root, "examples"),
    HUB_DEMO: "1",
    HUB_ENABLE_CHATS: "0",
    HUB_CLOUD: "0",
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
