import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const required = [
  "LICENSE",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".env.local.example",
  ".env.cloud.example",
  ".github/workflows/ci.yml",
  "docs/cloud.md",
  "docs/privacy.md",
];
const errors = required
  .filter((f) => !fs.existsSync(f))
  .map((f) => "Missing " + f);
let files;
try {
  files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  )
    .split("\0")
    .filter(Boolean);
} catch {
  const skipped = new Set([
    ".git",
    "node_modules",
    ".data",
    "dist",
    "release-evidence",
    "design-verification",
  ]);
  function walk(dir = "") {
    return fs
      .readdirSync(path.join(root, dir), { withFileTypes: true })
      .flatMap((entry) =>
        skipped.has(entry.name) ||
        (entry.name.startsWith(".env") && !entry.name.endsWith(".example"))
          ? []
          : entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : [path.join(dir, entry.name)],
      );
  }
  files = walk();
}
for (const file of files) {
  if (
    /^(\.data|\.vercel|\.neon|node_modules|release-evidence|design-verification)\//.test(
      file,
    ) ||
    /(^|\/)\.env(?![^/]*\.example$)/.test(file) ||
    /\.(sqlite(?:-wal|-shm)?|db|pem|key|log)$/.test(file)
  ) {
    errors.push("Private/runtime file in publication set: " + file);
    continue;
  }
  if (!fs.existsSync(file)) {
    errors.push("Missing tracked file: " + file);
    continue;
  }
  if (fs.lstatSync(file).isSymbolicLink()) {
    errors.push("Review symlink before release: " + file);
    continue;
  }
  if (!/\.(mjs|js|jsx|css|json|md|html|ya?ml|example)$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const checks = [
    [/\/Users\/[A-Za-z0-9_.-]+\//, "absolute personal Mac path"],
    [/\/home\/[A-Za-z0-9_.-]+\//, "absolute personal Linux path"],
    [/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/, "GitHub credential"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
    [
      /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@(?![^\s/]*example\.(?:org|com|test))[^\s"']+/,
      "database connection string",
    ],
  ];
  for (const [pattern, label] of checks)
    if (pattern.test(text)) errors.push(label + " in " + file);
}
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (pkg.license !== "MIT") errors.push("Expected MIT license metadata.");
if (!pkg.engines?.node) errors.push("Declare a Node version requirement.");
if (errors.length) {
  for (const error of errors) console.error("FAIL " + error);
  process.exitCode = 1;
} else
  console.log(
    "PASS: " +
      files.length +
      " publication files checked; required docs present; no forbidden runtime files or obvious private paths/credentials. Run Gitleaks separately before publishing.",
  );
