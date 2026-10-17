CREATE TABLE IF NOT EXISTS hub_state (
  id text PRIMARY KEY CHECK (id='owner'),
  data jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hub_cache (
  key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hub_limits (
  key text PRIMARY KEY, bucket bigint NOT NULL, count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_credentials (
  provider text PRIMARY KEY CHECK(provider IN ('github','vercel')),
  sealed text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hub_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_state,hub_cache,hub_limits,hub_credentials FROM PUBLIC;
CREATE TABLE IF NOT EXISTS hub_deployments (
  id text PRIMARY KEY, project_id text NOT NULL, team_id text NOT NULL,
  data jsonb NOT NULL, event_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_deployments_project ON hub_deployments(project_id, event_at DESC);
ALTER TABLE hub_deployments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_deployments FROM PUBLIC;
