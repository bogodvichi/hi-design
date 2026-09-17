-- hdw Resource Shares schema (hidesign-web)
--
-- Mirrors workspace_project_shares but for skill/mcp resources stored in
-- the resources table (kind = skill or kind = mcp). The share row is
-- a reference projection -- the resource stays in its home workspace; the
-- share row makes it visible to specific recipients in the shared space.
--
-- Design principles (same as workspace_project_shares):
--   1. Reference mode: the resource stays in its home workspace.
--   2. Owner exclusion: the sharer cannot see their own shared resources.
--   3. Recipient-scoped: each share targets specific recipients.
--   4. Cross-team stable IDs: uses shared-space member IDs.
--   5. kind column distinguishes skill vs mcp resources.

CREATE TABLE IF NOT EXISTS workspace_resource_shares (
    id                       TEXT PRIMARY KEY,
    resource_id              TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    kind                      TEXT NOT NULL DEFAULT 'skill'
                             CHECK (kind IN ('skill', 'mcp')),
    home_workspace_id        TEXT NOT NULL,
    shared_space_id          TEXT NOT NULL,
    recipient_member_id      TEXT NOT NULL,
    recipient_username       TEXT NOT NULL,
    created_by_member_id     TEXT,
    created_by_username      TEXT,
    created_by_displayname  TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_shares_recipient
    ON workspace_resource_shares(shared_space_id, recipient_member_id);

CREATE INDEX IF NOT EXISTS idx_resource_shares_resource
    ON workspace_resource_shares(resource_id);

CREATE INDEX IF NOT EXISTS idx_resource_shares_creator
    ON workspace_resource_shares(shared_space_id, created_by_member_id);

CREATE INDEX IF NOT EXISTS idx_resource_shares_kind
    ON workspace_resource_shares(kind, shared_space_id, recipient_member_id);

-- Grant DML privileges to the application database user.
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_resource_shares TO yapovichi;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_resource_shares TO postgres;

-- ===== Add FK constraint for existing databases =====
-- The CREATE TABLE above includes the FK for fresh databases. For databases
-- where the table already exists without the constraint, add it here.
-- Drop first for idempotency, then add.
ALTER TABLE workspace_resource_shares
    DROP CONSTRAINT IF EXISTS workspace_resource_shares_resource_id_fkey;
ALTER TABLE workspace_resource_shares
    ADD CONSTRAINT workspace_resource_shares_resource_id_fkey
    FOREIGN KEY (resource_id)
    REFERENCES resources(id)
    ON DELETE CASCADE;
