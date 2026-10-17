import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readState, saveCache } from "../cloud/store.mjs";
import { credential } from "../cloud/credentials.mjs";
import {
  integrationConfig,
  integrationSecret,
  saveIntegrationSecret,
  setIntegrationConfig,
  saveDeployment,
} from "../cloud/live.mjs";
import { normalizeDeployment } from "../server/live-data.mjs";
import {
  cloudConfig,
  httpsOrigin,
  syncLocation,
  launchAgent,
} from "./config.mjs";
import {
  vercelClient,
  projectCatalog,
  ensureWebhook,
} from "./vercel-events.mjs";
const command = process.argv[2];
if (!["prepare", "install", "stop"].includes(command))
  throw new Error("Use prepare, install, or stop. See docs/cloud.md.");
const origin =
  command === "stop"
    ? httpsOrigin(process.env.HUB_APP_ORIGIN)
    : cloudConfig().origin;
const root = fileURLToPath(new URL("../", import.meta.url));
if (command === "prepare") {
  const teamId = process.env.HUB_TEAM_ID;
  const request = vercelClient(await credential("vercel"), teamId);
  const state = await readState();
  const linked = state.projects.map((p) => p.vercel).filter(Boolean);
  if (!linked.length)
    throw new Error(
      "Add a project and link its Vercel project in the hub first.",
    );
  if (linked.some((l) => l.teamId !== teamId))
    throw new Error(
      "All linked deployments must belong to HUB_TEAM_ID in this single-team alpha.",
    );
  const catalog = await projectCatalog(request);
  const valid = new Set(catalog.map((p) => p.id));
  const config = await integrationConfig();
  const receiptFile = path.join(
    root,
    ".data/integrations",
    crypto.createHash("sha256").update(origin).digest("hex").slice(0, 12),
    "webhook-receipt.json",
  );
  const hook = await ensureWebhook({
    request,
    origin,
    receiptFile,
    existingId: config.vercelWebhookId,
    hasSecret: !!(await integrationSecret("vercelSecret")),
  });
  if (hook.secret) await saveIntegrationSecret("vercelSecret", hook.secret);
  await setIntegrationConfig({
    vercelWebhookId: hook.id,
    teamId,
    allTeamProjects: true,
    projectIds: linked.map((l) => l.projectId),
    missingProjectIds: linked
      .filter((l) => !valid.has(l.projectId))
      .map((l) => l.projectId),
    connectedAt: config.connectedAt || new Date().toISOString(),
  });
  await saveCache(
    "integration:vercel-projects",
    catalog.map((p) => ({
      id: p.id,
      name: p.name,
      teamId,
      repo: p.link?.org && p.link?.repo ? p.link.org + "/" + p.link.repo : null,
    })),
  );
  let count = 0;
  for (const link of linked.filter((l) => valid.has(l.projectId))) {
    const data = await request(
      "/v7/deployments?limit=30&projectId=" +
        encodeURIComponent(link.projectId),
    );
    for (const d of data.deployments || []) {
      await saveDeployment(
        normalizeDeployment(d, {
          ...link,
          eventAt: d.ready || d.createdAt || d.created,
        }),
      );
      count++;
    }
  }
  process.env.HUB_CLOUD = "1";
  await saveCache(
    "connections",
    await (await import("../server/providers.mjs")).connections(),
  );
  console.log(
    "Deployment events configured for linked projects. Loaded " +
      count +
      " historical deployments. New linked projects in this team receive future events automatically.",
  );
} else {
  if (process.platform !== "darwin")
    throw new Error(
      "Background chat sync installation currently supports macOS only. The local hub still works without it.",
    );
  const location = syncLocation(origin);
  const target = "gui/" + process.getuid();
  if (command === "stop") {
    const loaded = (() => {
      try {
        execFileSync("launchctl", ["print", target + "/" + location.label], {
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    })();
    if (loaded)
      execFileSync("launchctl", ["bootout", target + "/" + location.label], {
        stdio: "pipe",
      });
    // Keep data for recovery but prevent a stopped job from loading at next login.
    if (fs.existsSync(location.plist))
      fs.renameSync(location.plist, location.plist + ".disabled");
    console.log(
      "Chat sync stopped for " +
        origin +
        ". Private sync files were preserved.",
    );
  } else {
    let secret = await integrationSecret("chatSecret");
    if (!secret) {
      secret = crypto.randomBytes(32).toString("base64url");
      await saveIntegrationSecret("chatSecret", secret);
    }
    fs.mkdirSync(location.dir, { recursive: true, mode: 0o700 });
    const configFile = path.join(location.dir, "config.json");
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        origin,
        secret,
        includeUnassigned: process.argv.includes("--include-unassigned"),
        localStateFile: path.resolve(
          process.env.HUB_DATA_DIR || path.join(root, ".data"),
          "hub.json",
        ),
      }),
      { mode: 0o600 },
    );
    fs.chmodSync(configFile, 0o600);
    for (const name of ["chat-sync.mjs", "chat-reader.mjs", "config.mjs"])
      fs.copyFileSync(
        new URL(name, import.meta.url),
        path.join(location.dir, name),
      );
    fs.mkdirSync(path.dirname(location.plist), { recursive: true });
    fs.writeFileSync(
      location.plist,
      launchAgent({
        ...location,
        executable: process.execPath,
        script: path.join(location.dir, "chat-sync.mjs"),
      }),
      { mode: 0o600 },
    );
    try {
      execFileSync("launchctl", ["bootout", target + "/" + location.label], {
        stdio: "ignore",
      });
    } catch {}
    execFileSync("launchctl", ["bootstrap", target, location.plist], {
      stdio: "pipe",
    });
    console.log(
      "Installed 10-second metadata sync to " +
        origin +
        ". No transcripts or provider credentials are uploaded. Run npm run sync:stop to stop it.",
    );
  }
}
