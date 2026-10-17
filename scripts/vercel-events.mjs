import fs from "node:fs";
import path from "node:path";
import { httpsOrigin } from "./config.mjs";
export const events = [
  "deployment.created",
  "deployment.succeeded",
  "deployment.error",
  "deployment.canceled",
  "deployment.promoted",
  "deployment.rollback",
];
export function vercelClient(token, teamId, fetcher = fetch) {
  if (!token || !/^team_[\w]+$/.test(teamId || ""))
    throw new Error(
      "Set HUB_TEAM_ID and connect Vercel before preparing events.",
    );
  return async (route, body) => {
    const url = new URL(route, "https://api.vercel.com");
    if (url.origin !== "https://api.vercel.com")
      throw new Error("Invalid Vercel API endpoint.");
    url.searchParams.set("teamId", teamId);
    const response = await fetcher(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        "Vercel request failed (HTTP " +
          response.status +
          "). Check your token and team access.",
      );
    return response.json();
  };
}
export async function projectCatalog(request) {
  const items = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const data = await request(
      "/v9/projects?limit=100" +
        (cursor ? "&from=" + encodeURIComponent(cursor) : ""),
    );
    items.push(...(data.projects || []));
    if (!data.pagination?.next) return items;
    if (data.pagination.next === cursor)
      throw new Error(
        "Vercel returned a repeated catalog page. No configuration changed.",
      );
    cursor = data.pagination.next;
  }
  throw new Error("This alpha supports up to 1,000 Vercel projects per team.");
}
export async function ensureWebhook({
  request,
  origin,
  receiptFile,
  existingId,
  hasSecret,
}) {
  const url = httpsOrigin(origin) + "/api/events/vercel";
  if (existingId && hasSecret) {
    const existing = await request(
      "/v1/webhooks/" + encodeURIComponent(existingId),
    );
    if (
      existing.url !== url ||
      existing.projectIds?.length ||
      !events.every((e) => existing.events?.includes(e))
    )
      throw new Error(
        "The saved webhook does not match this hub or event scope. Review the webhook in Vercel before changing configuration.",
      );
    return { id: existingId };
  }
  let recovered;
  try {
    recovered = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  } catch {}
  if (recovered?.url === url && recovered.id && recovered.secret) {
    const existing = await request(
      "/v1/webhooks/" + encodeURIComponent(recovered.id),
    );
    if (existing.url !== url)
      throw new Error("Saved webhook receipt does not match Vercel.");
    return recovered;
  }
  const listed = await request("/v1/webhooks");
  const hooks = Array.isArray(listed) ? listed : listed.webhooks || [];
  if (hooks.some((h) => h.url === url))
    throw new Error(
      "A webhook already exists for this hub, but its signing secret is unavailable. Restore the private receipt, or remove that webhook in Vercel before retrying. A duplicate was not created.",
    );
  // Omitting projectIds covers new projects in this team. The receiver discards unlinked projects.
  const hook = await request("/v1/webhooks", { url, events });
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(receiptFile, JSON.stringify(hook), { mode: 0o600 });
  fs.chmodSync(receiptFile, 0o600);
  if (!hook.id || !hook.secret || hook.url !== url)
    throw new Error(
      "Vercel returned an incomplete webhook receipt. Review it privately before retrying.",
    );
  return hook;
}
