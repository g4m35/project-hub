import { db, readCache, saveCache } from "./store.mjs";
import { seal, unseal } from "./credentials.mjs";
import { chatView } from "../server/live-data.mjs";

export async function integrationConfig() {
  return (await readCache("integration:live"))?.value || {};
}
export async function setIntegrationConfig(update) {
  const previous = await integrationConfig();
  await saveCache("integration:live", { ...previous, ...update });
}
export async function integrationSecret(name) {
  const config = await integrationConfig();
  return config[name] ? unseal(config[name]) : null;
}
export async function saveIntegrationSecret(name, secret) {
  await setIntegrationConfig({ [name]: seal(secret) });
}
export async function saveDeployment(row) {
  const sql = db();
  // A retried or out-of-order creation event cannot put a finished build back in progress.
  await sql`INSERT INTO hub_deployments(id,project_id,team_id,data,event_at)
    VALUES(${row.id},${row.projectId},${row.teamId},${JSON.stringify(row)}::jsonb,${row.eventAt}::timestamptz)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data || jsonb_build_object('createdAt',hub_deployments.data->'createdAt'),event_at=excluded.event_at
    WHERE excluded.event_at > hub_deployments.event_at
      AND NOT (excluded.data->>'state'='BUILDING' AND hub_deployments.data->>'state' IN ('READY','ERROR','CANCELED'))`;
}
export async function liveDeployments(link) {
  if (!link?.projectId) return { status: "unlinked", deployments: [] };
  const config = await integrationConfig();
  if (config.missingProjectIds?.includes(link.projectId))
    return {
      status: "error",
      error:
        "This Vercel project no longer exists. Choose its current project in Connections.",
      deployments: [],
    };
  if (
    !config.vercelWebhookId ||
    config.teamId !== link.teamId ||
    (!config.allTeamProjects && !config.projectIds?.includes(link.projectId))
  )
    return null;
  const sql = db();
  const rows =
    await sql`SELECT data FROM hub_deployments WHERE project_id=${link.projectId} AND team_id=${link.teamId}
    ORDER BY (data->>'createdAt')::timestamptz DESC LIMIT 30`;
  return {
    status: "connected",
    mode: "events",
    listeningSince: config.connectedAt,
    syncedAt: rows.reduce(
      (latest, r) =>
        !latest || r.data.eventAt > latest ? r.data.eventAt : latest,
      null,
    ),
    deployments: rows.map((r) => r.data),
    checkedAt: new Date().toISOString(),
  };
}
export async function liveChats(projectId) {
  return chatView((await readCache("live:chats"))?.value, projectId);
}
export async function saveChats(data) {
  const sql = db();
  await sql`INSERT INTO hub_cache(key,data) VALUES('live:chats',${JSON.stringify(data)}::jsonb)
    ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=now()
    WHERE excluded.data->>'capturedAt' > hub_cache.data->>'capturedAt'`;
}
