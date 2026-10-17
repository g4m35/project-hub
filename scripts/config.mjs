import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export function httpsOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Set HUB_APP_ORIGIN to your HTTPS hub address.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "HUB_APP_ORIGIN must be an HTTPS origin with no path, credentials, query or fragment.",
    );
  return url.origin;
}
export function cloudConfig(env = process.env) {
  const origin = httpsOrigin(env.HUB_APP_ORIGIN);
  if (
    !env.HUB_OWNER_EMAIL ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.HUB_OWNER_EMAIL) ||
    env.HUB_OWNER_EMAIL.endsWith("@example.com")
  )
    throw new Error(
      "Set HUB_OWNER_EMAIL to the email you will use to sign in.",
    );
  if (
    !env.HUB_SESSION_SECRET ||
    env.HUB_SESSION_SECRET.length < 32 ||
    /^(replace|change)/i.test(env.HUB_SESSION_SECRET)
  )
    throw new Error(
      "Generate a random HUB_SESSION_SECRET with at least 32 characters.",
    );
  let auth, database;
  try {
    auth = new URL(env.NEON_AUTH_BASE_URL);
    database = new URL(env.DATABASE_URL);
  } catch {
    throw new Error(
      "Set DATABASE_URL and NEON_AUTH_BASE_URL from your Neon project.",
    );
  }
  if (
    auth.protocol !== "https:" ||
    auth.username ||
    auth.password ||
    auth.search ||
    auth.hash ||
    /example\.(com|test)$/.test(auth.hostname)
  )
    throw new Error("NEON_AUTH_BASE_URL must be your HTTPS Neon Auth URL.");
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !database.password ||
    database.hostname.endsWith("example.com")
  )
    throw new Error(
      "DATABASE_URL must be your private Postgres connection string.",
    );
  return { origin, ownerEmail: env.HUB_OWNER_EMAIL.trim().toLowerCase() };
}
export function syncLocation(origin, home = os.homedir()) {
  const key = crypto
    .createHash("sha256")
    .update(httpsOrigin(origin))
    .digest("hex")
    .slice(0, 12);
  const label = "com.projecthub.opensource.sync." + key;
  return {
    label,
    dir: path.join(
      home,
      "Library/Application Support/Project Hub Open Source/Sync",
      key,
    ),
    plist: path.join(home, "Library/LaunchAgents", label + ".plist"),
  };
}
export const xml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function launchAgent({ label, executable, script, dir }) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array><string>${xml(executable)}</string><string>${xml(script)}</string><string>${xml(dir)}</string></array><key>RunAtLoad</key><true/><key>StartInterval</key><integer>10</integer><key>ProcessType</key><string>Background</string><key>StandardErrorPath</key><string>${xml(path.join(dir, "sync.log"))}</string></dict></plist>`;
}
