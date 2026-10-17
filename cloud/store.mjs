import { neon } from "@neondatabase/serverless";
let client;
export function db() {
  if (!process.env.DATABASE_URL)
    throw new Error("Cloud storage is not configured.");
  return (client ||= neon(process.env.DATABASE_URL));
}
export async function readState() {
  const sql = db();
  const [row] =
    await sql`SELECT data, revision FROM hub_state WHERE id = 'owner'`;
  if (!row) throw new Error("Your cloud import is not ready yet.");
  return { ...row.data, revision: row.revision };
}
// Compare-and-swap preserves edits from other phones, tabs and function instances.
export async function changeState(update) {
  const sql = db();
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await readState();
    const revision = state.revision;
    delete state.revision;
    const result = update(state);
    const rows =
      await sql`UPDATE hub_state SET data=${JSON.stringify(state)}::jsonb,
      revision=revision+1, updated_at=now() WHERE id='owner' AND revision=${revision} RETURNING revision`;
    if (rows.length) return result;
  }
  throw new Error("Another device is saving. Please try again.");
}
export async function rateLimit(key, maximum, seconds) {
  const sql = db();
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const [row] =
    await sql`INSERT INTO hub_limits (key, bucket, count) VALUES (${key},${bucket},1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN hub_limits.bucket=${bucket} THEN hub_limits.count+1 ELSE 1 END,
    bucket=${bucket} RETURNING count`;
  return Number(row.count) <= maximum;
}
export async function readCache(key) {
  const sql = db();
  const [row] =
    await sql`SELECT data, updated_at FROM hub_cache WHERE key=${key}`;
  return row
    ? { value: row.data, at: new Date(row.updated_at).getTime() }
    : null;
}
export async function saveCache(key, value) {
  const sql = db();
  await sql`INSERT INTO hub_cache (key,data) VALUES (${key},${JSON.stringify(value)}::jsonb)
    ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=now()`;
}
