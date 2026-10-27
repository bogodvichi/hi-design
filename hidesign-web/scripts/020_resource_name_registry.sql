-- Pre-deployment, non-destructive schema for Skill/MCP source-name claims.
-- Execute BEFORE upgrading HDW; run resource-name-registry-backfill.js --apply
-- afterwards, and confirm the registry state is ready.
BEGIN;
CREATE TABLE IF NOT EXISTS resource_name_registry (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('skill', 'mcp')),
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resource_name_registry_kind_name
  ON resource_name_registry (kind, normalized_name);
CREATE INDEX IF NOT EXISTS idx_resources_public_reference_source
  ON resources (kind, (metadata ->> 'communitySourceResourceId'))
  WHERE deleted_at IS NULL AND scope = 'public'
    AND (metadata ->> 'communitySourceResourceId') IS NOT NULL;
CREATE TABLE IF NOT EXISTS resource_name_registry_state (
  id TEXT PRIMARY KEY,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = 'global')
);
INSERT INTO resource_name_registry_state(id, ready)
  VALUES ('global', FALSE)
  ON CONFLICT (id) DO NOTHING;
-- Depending on the deployment role, grant permissions explicitly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yapovichi') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON resource_name_registry TO yapovichi;
    GRANT SELECT, UPDATE ON resource_name_registry_state TO yapovichi;
  END IF;
END $$;
COMMENT ON TABLE resource_name_registry IS
  'One indexed name claim per logical Skill/MCP source. Historic duplicates are preserved.';
COMMENT ON TABLE resource_name_registry_state IS
  'Backfill readiness gate. Do not enable HDW name enforcement until ready is true.';
COMMIT;
