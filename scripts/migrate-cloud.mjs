import fs from "node:fs";
import { db, readState } from "../cloud/store.mjs";
import { cloudConfig } from "./config.mjs";
cloudConfig();
const sql = db();
const schema = fs.readFileSync(
  new URL("../cloud/schema.sql", import.meta.url),
  "utf8",
);
for (const command of schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean))
  await sql.query(command);
// No local projects, chat history, or subscriptions are imported implicitly.
const empty = { version: 1, projects: [], subscriptions: [], seeded: true };
await sql`INSERT INTO hub_state (id,data) VALUES ('owner',${JSON.stringify(empty)}::jsonb) ON CONFLICT(id) DO NOTHING`;
const state = await readState();
console.log(
  JSON.stringify({
    initialized: true,
    projects: state.projects.length,
    subscriptions: state.subscriptions.length,
    existingDataPreserved: true,
  }),
);
