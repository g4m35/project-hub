import test from "node:test";
import assert from "node:assert/strict";
import {
  ownerMatches,
  validateOrigin,
  getOwnerSession,
  csrfFor,
  checkCsrf,
  safeCookie,
} from "../cloud/security.mjs";
import { seal, unseal } from "../cloud/credentials.mjs";
process.env.HUB_OWNER_EMAIL = "owner@example.com";
process.env.HUB_APP_ORIGIN = "https://hub.example.com";
process.env.HUB_SESSION_SECRET = "test-secret-used-only-for-unit-tests";
process.env.NEON_AUTH_BASE_URL = "https://auth.example.com/auth";
test("only a verified owner is authorized, including case normalization", () => {
  assert.equal(
    ownerMatches({ email: "OWNER@example.com", emailVerified: true }),
    true,
  );
  for (const user of [
    null,
    { email: "owner@example.com", emailVerified: false },
    { email: "stranger@example.com", emailVerified: true },
  ])
    assert.equal(ownerMatches(user), false);
});
test("cross-site requests and writes without the app origin are refused", () => {
  for (const headers of [
    {},
    { origin: "https://attacker.test" },
    { origin: "https://hub.example.com", "sec-fetch-site": "cross-site" },
  ])
    assert.throws(
      () => validateOrigin({ method: "POST", headers }),
      (e) => e.status === 403,
    );
  assert.doesNotThrow(() =>
    validateOrigin({
      method: "POST",
      headers: { origin: "https://hub.example.com" },
    }),
  );
});
test("CSRF tokens are bound to one authenticated session", () => {
  const session = { id: "one" },
    token = csrfFor(session);
  assert.equal(checkCsrf(token, session), true);
  assert.equal(checkCsrf(token, { id: "two" }), false);
  assert.equal(checkCsrf(undefined, session), false);
  assert.equal(checkCsrf("bad", session), false);
});
test("server session verification rejects absent, expired, and non-owner sessions", async () => {
  const req = { headers: { cookie: "session=opaque" } };
  const owner = { email: "owner@example.com", emailVerified: true };
  for (const data of [
    null,
    { session: { id: "x", expiresAt: "2020-01-01" }, user: owner },
    {
      session: { id: "x", expiresAt: "2099-01-01" },
      user: { ...owner, email: "other@example.com" },
    },
  ])
    await assert.rejects(
      getOwnerSession(req, async () => Response.json(data)),
      (e) => [401, 403].includes(e.status),
    );
  await assert.rejects(
    getOwnerSession({ headers: {} }, () => {
      throw Error("must not fetch");
    }),
    (e) => e.status === 401,
  );
  const data = { session: { id: "x", expiresAt: "2099-01-01" }, user: owner };
  assert.deepEqual(
    await getOwnerSession(req, async () => Response.json(data)),
    data,
  );
});
test("auth proxy cookies are scoped to the hub and retain HTTPS and HttpOnly", () => {
  const cookie = safeCookie(
    "session=opaque; Domain=auth.example.com; Path=/auth; Secure; HttpOnly; SameSite=None",
  );
  assert.equal(
    cookie,
    "session=opaque; Path=/; Secure; HttpOnly; SameSite=Lax",
  );
});
test("cloud provider secrets are encrypted and reject tampering", () => {
  const encrypted = seal("test-provider-secret");
  assert.equal(encrypted.includes("test-provider-secret"), false);
  assert.equal(unseal(encrypted), "test-provider-secret");
  const segments = encrypted.split(".");
  segments[2] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => unseal(segments.join(".")));
});
