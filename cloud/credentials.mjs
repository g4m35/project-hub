import crypto from "node:crypto";
import { db } from "./store.mjs";
function key() {
  if (!process.env.HUB_SESSION_SECRET)
    throw new Error("Cloud encryption is not configured.");
  return crypto
    .createHash("sha256")
    .update(process.env.HUB_SESSION_SECRET)
    .digest();
}
export function seal(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((x) => x.toString("base64url"))
    .join(".");
}
export function unseal(value) {
  const [iv, tag, body] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const cipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
export async function credential(provider) {
  const sql = db();
  const [row] =
    await sql`SELECT sealed FROM hub_credentials WHERE provider=${provider}`;
  return row
    ? unseal(row.sealed)
    : process.env[
        provider === "github" ? "HUB_GITHUB_TOKEN" : "HUB_VERCEL_TOKEN"
      ];
}
export async function saveCredential(provider, value) {
  const sql = db();
  await sql`INSERT INTO hub_credentials (provider, sealed) VALUES (${provider}, ${seal(value)})
    ON CONFLICT(provider) DO UPDATE SET sealed=excluded.sealed,updated_at=now()`;
}
