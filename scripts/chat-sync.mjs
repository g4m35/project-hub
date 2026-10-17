import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { httpsOrigin } from "./config.mjs";
import path from "node:path";
import { collectChats } from "./chat-reader.mjs";

// Installed by setup-live.mjs as a launchd job. No database or provider credentials are copied.
const dir = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  fs.readFileSync(path.join(dir, "config.json"), "utf8"),
);
const origin = httpsOrigin(config.origin);
if (typeof config.secret !== "string" || config.secret.length < 32)
  throw new Error("Invalid sync credential. Reinstall sync.");
const headers = {
  Authorization: "Bearer " + config.secret,
  "Content-Type": "application/json",
};
async function request(route, body) {
  const response = await fetch(origin + "/api/sync/" + route, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Chat sync HTTP " + response.status);
  return response.json();
}
try {
  let catalog;
  try {
    catalog = JSON.parse(
      fs.readFileSync(path.join(dir, "projects.json"), "utf8"),
    );
  } catch {}
  if (!catalog || Date.now() - catalog.at > 60000) {
    catalog = { at: Date.now(), ...(await request("projects")) };
    fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify(catalog), {
      mode: 0o600,
    });
  }
  const data = collectChats(catalog.projects, {
    localStateFile: config.localStateFile,
    includeUnassigned: config.includeUnassigned === true,
  });
  await request("chats", data);
  fs.writeFileSync(
    path.join(dir, "status.json"),
    JSON.stringify({
      ok: true,
      at: new Date().toISOString(),
      sources: data.sources,
      chats: data.projects.reduce((n, p) => n + p.chats.length, 0),
    }),
    { mode: 0o600 },
  );
} catch (error) {
  fs.writeFileSync(
    path.join(dir, "status.json"),
    JSON.stringify({
      ok: false,
      at: new Date().toISOString(),
      error: error.message,
    }),
    { mode: 0o600 },
  );
  process.exitCode = 1;
}
