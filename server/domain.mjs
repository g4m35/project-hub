import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const exec = promisify(execFile);
export const home = os.homedir();
export const roots = process.env.HUB_PROJECT_ROOTS
  ? process.env.HUB_PROJECT_ROOTS.split(path.delimiter)
      .filter(Boolean)
      .map((p) => path.resolve(p.replace(/^~(?=\/)/, home)))
  : [
      path.resolve(process.cwd()),
      ...["Desktop", "dev", "Developer", "Documents"].map((p) =>
        path.join(home, p),
      ),
    ];
export const id = (value) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
export function json(file, fallback = null) {
  try {
    if (fs.statSync(file).size > 2_000_000) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
export function safePath(value) {
  if (typeof value !== "string") throw new Error("Choose a project folder.");
  let resolved;
  try {
    resolved = fs.realpathSync(value.replace(/^~(?=\/)/, home));
  } catch {
    throw new Error("That folder is not available.");
  }
  if (
    !roots.some((root) => {
      try {
        const realRoot = fs.realpathSync(root);
        return (
          resolved === realRoot || resolved.startsWith(realRoot + path.sep)
        );
      } catch {
        return false;
      }
    }) ||
    !fs.statSync(resolved).isDirectory()
  )
    throw new Error(
      "Choose a project under an allowed folder. Set HUB_PROJECT_ROOTS in .env.local to add a location.",
    );
  return resolved;
}
export function repoName(value) {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(
      /^(?:(?:https:\/\/github\.com\/|git@github\.com:))?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
    );
  return match && !match[1].split("/").some((x) => x === "." || x === "..")
    ? match[1]
    : null;
}
const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "vendor",
  "Pods",
  "coverage",
  ".cache",
  ".venv",
  "venv",
  "DerivedData",
  "outputs",
  "output",
  "work",
  "scratchpad",
  ".turbo",
  "examples",
  "fixtures",
  "__fixtures__",
]);
export function isProjectManifest(file) {
  const parts = file.split("/");
  return (
    parts.at(-1) === "package.json" &&
    parts.length <= 5 &&
    parts
      .slice(0, -1)
      .every((part) => !ignored.has(part) && !part.startsWith("."))
  );
}
export function manifests(root, maxDepth = 3) {
  const files = [];
  let count = 0;
  function visit(dir, depth) {
    if (count++ > 600 || depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (
        entry.isFile() &&
        [
          "package.json",
          "pyproject.toml",
          "requirements.txt",
          "Cargo.toml",
          "go.mod",
          "docker-compose.yml",
          "compose.yaml",
          "schema.prisma",
          "wrangler.toml",
          "vercel.json",
          "app.json",
        ].includes(entry.name)
      )
        files.push(full);
      if (
        entry.isDirectory() &&
        !ignored.has(entry.name) &&
        !entry.name.startsWith(".")
      )
        visit(full, depth + 1);
    }
  }
  visit(root, 0);
  return files;
}
const definitions = [
  ["Next.js", "Web + API", "app", ["next"]],
  ["React", "Web app", "app", ["react"]],
  ["Expo", "Mobile app", "app", ["expo"]],
  ["React Native", "Mobile app", "app", ["react-native"]],
  ["Express", "API", "api", ["express"]],
  ["Fastify", "API", "api", ["fastify"]],
  ["Hono", "API", "api", ["hono"]],
  ["NestJS", "API", "api", ["@nestjs/core"]],
  [
    "PostgreSQL",
    "Database",
    "data",
    ["pg", "postgres", "@neondatabase/serverless"],
  ],
  ["Prisma", "Data access", "data", ["@prisma/client", "prisma"]],
  ["Drizzle", "Data access", "data", ["drizzle-orm"]],
  ["Redis", "Cache", "data", ["redis", "ioredis", "@upstash/redis"]],
  [
    "Sentry",
    "Error tracking",
    "service",
    ["@sentry/nextjs", "@sentry/react", "@sentry/node", "@sentry/react-native"],
  ],
  ["Resend", "Email", "service", ["resend"]],
  ["Stripe", "Payments", "service", ["stripe", "@stripe/stripe-js"]],
  [
    "Clerk",
    "Authentication",
    "service",
    ["@clerk/nextjs", "@clerk/clerk-react"],
  ],
  ["Supabase", "Backend services", "service", ["@supabase/supabase-js"]],
  ["Firebase", "Backend services", "service", ["firebase", "firebase-admin"]],
  ["OpenAI", "AI", "service", ["openai"]],
  [
    "Browserbase",
    "Browser automation",
    "service",
    ["@browserbasehq/sdk", "@browserbasehq/stagehand"],
  ],
];
export function detectStack(packages, extras = []) {
  const nodes = [];
  for (const [name, role, kind, deps] of definitions) {
    const evidence = packages
      .filter((p) => deps.some((d) => p.dependencies[d]))
      .map((p) => p.source);
    if (evidence.length)
      nodes.push({
        id: id(name),
        name,
        role,
        kind,
        evidence: [...new Set(evidence)],
        detected: true,
      });
  }
  if (nodes.some((n) => n.name === "Next.js"))
    nodes.splice(
      nodes.findIndex((n) => n.name === "React"),
      nodes.some((n) => n.name === "React") ? 1 : 0,
    );
  if (nodes.some((n) => n.name === "Expo")) {
    const i = nodes.findIndex((n) => n.name === "React Native");
    if (i >= 0) nodes.splice(i, 1);
  }
  for (const extra of extras)
    if (!nodes.some((n) => n.name === extra.name))
      nodes.push({ ...extra, id: id(extra.name), detected: true });
  return nodes;
}
export async function scanProject(folder, name) {
  const root = safePath(folder),
    files = manifests(root),
    packages = [],
    extras = [];
  for (const file of files) {
    const source = path.relative(root, file);
    if (file.endsWith("/package.json")) {
      const p = json(file, {});
      packages.push({
        source,
        dependencies: { ...p.dependencies, ...p.devDependencies },
      });
    }
    if (/requirements.txt|pyproject.toml/.test(file))
      extras.push({
        name: "Python",
        role: "Backend",
        kind: "api",
        evidence: [source],
      });
    if (file.endsWith("/Cargo.toml"))
      extras.push({
        name: "Rust",
        role: "Application",
        kind: "app",
        evidence: [source],
      });
    if (file.endsWith("/go.mod"))
      extras.push({
        name: "Go",
        role: "Backend",
        kind: "api",
        evidence: [source],
      });
    if (/docker-compose.yml|compose.yaml/.test(file))
      extras.push({
        name: "Docker",
        role: "Local services",
        kind: "deploy",
        evidence: [source],
      });
    if (file.endsWith("/wrangler.toml"))
      extras.push({
        name: "Cloudflare",
        role: "Hosting",
        kind: "deploy",
        evidence: [source],
      });
  }
  let repo = null;
  try {
    repo = repoName(
      (
        await exec(
          "git",
          ["-C", root, "config", "--get", "remote.origin.url"],
          { timeout: 4000 },
        )
      ).stdout.trim(),
    );
  } catch {}
  if (repo)
    extras.push({
      name: "GitHub",
      role: "Source + issues",
      kind: "source",
      evidence: ["Git remote: " + repo],
    });
  const vercel = json(path.join(root, ".vercel/project.json"));
  if (vercel?.projectId || files.some((f) => f.endsWith("/vercel.json")))
    extras.push({
      name: "Vercel",
      role: "Hosting",
      kind: "deploy",
      evidence: [vercel?.projectId ? ".vercel/project.json" : "vercel.json"],
    });
  if (fs.existsSync(path.join(root, ".circleci/config.yml")))
    extras.push({
      name: "CircleCI",
      role: "CI pipeline",
      kind: "deploy",
      evidence: [".circleci/config.yml"],
    });
  if (fs.existsSync(path.join(root, ".github/workflows")))
    extras.push({
      name: "GitHub Actions",
      role: "CI pipeline",
      kind: "deploy",
      evidence: [".github/workflows"],
    });
  const title =
    name?.trim() ||
    path
      .basename(root)
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (s) => s.toUpperCase());
  return {
    id: id(root),
    name: title,
    path: root,
    repo,
    stack: detectStack(packages, extras),
    vercel: vercel?.projectId
      ? { projectId: vercel.projectId, teamId: vercel.orgId }
      : null,
    scannedAt: new Date().toISOString(),
    files: files.map((f) => path.relative(root, f)),
    modifiedAt: fs.statSync(root).mtime.toISOString(),
  };
}
export async function discover() {
  const candidates = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const p = path.join(root, e.name);
      if (
        [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"].some(
          (n) => fs.existsSync(path.join(p, n)),
        )
      )
        candidates.push({ path: p, name: e.name });
    }
  }
  return candidates.sort(
    (a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs,
  );
}
export function validateSubscription(input, projects) {
  const name = String(input.name || "").trim(),
    amount = Number(input.amount),
    currency = String(input.currency || "").toUpperCase(),
    nextDue = String(input.nextDue || "");
  if (!name || name.length > 100)
    throw new Error("Enter a service name (up to 100 characters).");
  if (
    input.amount === "" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 1e9
  )
    throw new Error("Enter a valid non-negative amount.");
  if (!["USD", "CAD", "EUR", "GBP", "AUD", "JPY", "INR"].includes(currency))
    throw new Error("Choose a supported currency.");
  const date = new Date(nextDue + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(nextDue) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== nextDue
  )
    throw new Error("Choose a valid due date.");
  if (!["monthly", "yearly", "one-time"].includes(input.interval))
    throw new Error("Choose a billing period.");
  if (
    input.projectId !== "shared" &&
    !projects.some((p) => p.id === input.projectId)
  )
    throw new Error("Choose a project or shared subscription.");
  return {
    name,
    amount,
    currency,
    nextDue,
    interval: input.interval,
    projectId: input.projectId,
    notes: String(input.notes || "").slice(0, 1000),
    updatedAt: new Date().toISOString(),
  };
}
