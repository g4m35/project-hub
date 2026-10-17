import crypto from "node:crypto";
import { rateLimit } from "./store.mjs";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function appOrigin() {
  const value = process.env.HUB_APP_ORIGIN;
  if (!value || !value.startsWith("https://"))
    throw new HttpError(503, "Cloud access is not configured.");
  return new URL(value).origin;
}
export function ownerMatches(user) {
  return (
    !!process.env.HUB_OWNER_EMAIL &&
    user?.emailVerified === true &&
    user.email?.toLowerCase() === process.env.HUB_OWNER_EMAIL.toLowerCase()
  );
}
export function validateOrigin(req) {
  const allowed = appOrigin();
  if (req.headers.origin && req.headers.origin !== allowed)
    throw new HttpError(403, "This request came from another website.");
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new HttpError(403, "Cross-site requests are blocked.");
  if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== allowed)
    throw new HttpError(403, "Open Project Hub and try again.");
}
export function csrfFor(session) {
  if (!process.env.HUB_SESSION_SECRET)
    throw new HttpError(503, "Cloud access is not configured.");
  return crypto
    .createHmac("sha256", process.env.HUB_SESSION_SECRET)
    .update(session.id)
    .digest("hex");
}
export function checkCsrf(value, session) {
  const expected = csrfFor(session);
  return (
    typeof value === "string" &&
    value.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
export async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
    throw new HttpError(415, "Send JSON to this endpoint.");
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (JSON.stringify(req.body).length > 64000)
      throw new HttpError(413, "Request too large.");
    return req.body;
  }
  let value = typeof req.body === "string" ? req.body : "";
  if (!value)
    for await (const chunk of req) {
      value += chunk;
      if (value.length > 64000) throw new HttpError(413, "Request too large.");
    }
  if (Buffer.byteLength(value) > 64000)
    throw new HttpError(413, "Request too large.");
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    throw new HttpError(400, "The request could not be read.");
  }
}
export async function getOwnerSession(req, fetcher = fetch) {
  if (!req.headers.cookie)
    throw new HttpError(401, "Sign in to open your hub.");
  const r = await fetcher(
    process.env.NEON_AUTH_BASE_URL + "/get-session?disableCookieCache=true",
    {
      headers: { Cookie: req.headers.cookie, Origin: appOrigin() },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    },
  );
  if (!r.ok)
    throw new HttpError(401, "Your sign-in expired. Please sign in again.");
  const result = await r.json();
  if (
    !result?.session?.id ||
    !result?.user ||
    !Number.isFinite(new Date(result.session.expiresAt).getTime()) ||
    new Date(result.session.expiresAt).getTime() <= Date.now()
  )
    throw new HttpError(401, "Sign in to open your hub.");
  if (!ownerMatches(result.user))
    throw new HttpError(
      403,
      "This private hub belongs to a different account.",
    );
  return result;
}
export function safeCookie(cookie) {
  // The managed session is proxied through this host so Safari does not need third-party cookies.
  return cookie
    .replace(/;\s*Domain=[^;]+/gi, "")
    .replace(/;\s*Path=[^;]+/gi, "; Path=/")
    .replace(/;\s*SameSite=[^;]+/gi, "; SameSite=Lax");
}
export async function authProxy(req, res, route) {
  const allowed = new Map([
    ["get-session", "GET"],
    ["sign-out", "POST"],
    ["email-otp/send-verification-otp", "POST"],
    ["sign-in/email-otp", "POST"],
  ]);
  if (allowed.get(route) !== req.method) throw new HttpError(404, "Not found.");
  let body;
  if (req.method === "POST") {
    body = await readBody(req);
    if (route.includes("email-otp")) {
      if (
        typeof body.email !== "string" ||
        body.email.toLowerCase().trim() !==
          process.env.HUB_OWNER_EMAIL?.toLowerCase()
      )
        throw new HttpError(403, "Use the email address for the hub owner.");
      body.email = process.env.HUB_OWNER_EMAIL.toLowerCase();
      if (route === "email-otp/send-verification-otp")
        body = { email: body.email, type: "sign-in" };
      else
        body = { email: body.email, otp: String(body.otp || "").slice(0, 16) };
      const ip = String(
        req.headers["x-vercel-forwarded-for"] ||
          req.headers["x-forwarded-for"] ||
          "unknown",
      ).split(",")[0];
      const key = crypto
        .createHmac("sha256", process.env.HUB_SESSION_SECRET)
        .update(route + ":" + ip)
        .digest("hex");
      if (
        !(await rateLimit(
          "auth:" + key,
          route.startsWith("sign-in") ? 10 : 5,
          900,
        ))
      )
        throw new HttpError(429, "Too many attempts. Please wait 15 minutes.");
      if (
        route === "email-otp/send-verification-otp" &&
        !(await rateLimit("auth:email", 8, 3600))
      )
        throw new HttpError(
          429,
          "Too many codes requested. Please use your latest code.",
        );
    }
  }
  const upstream = await fetch(process.env.NEON_AUTH_BASE_URL + "/" + route, {
    method: req.method,
    headers: {
      Origin: appOrigin(),
      "Content-Type": "application/json",
      ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const cookies = upstream.headers.getSetCookie().map(safeCookie);
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.statusCode = upstream.status;
  res.end(await upstream.text());
}
