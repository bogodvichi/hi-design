-- Database corrections for ResourceHub + workspace tables
-- Addresses issues found during full schema audit:
--   1. workspaces/workspace_members missing updated_at triggers (safety net)
--   2. workspace_members missing index on workspace_member_id alone
--   3. project_transfers missing indexes on source/target workspace_id
--   4. project_transfers FKs block workspace deletion (audit log must persist)

-- ===== 1. updated_at triggers for workspaces and workspace_members =====
-- The team controller manually sets updated_at today, but a trigger is a
-- safety net so no future update path can forget it.

DROP TRIGGER IF EXISTS trg_workspaces_updated ON workspaces;
CREATE TRIGGER trg_workspaces_updated
    BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_workspace_members_updated ON workspace_members;
CREATE TRIGGER trg_workspace_members_updated
    BEFORE UPDATE ON workspace_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===== 2. Index on workspace_members.workspace_member_id =====
-- The composite PK index (workspace_id, workspace_member_id) doesn't serve
-- queries that filter by workspace_member_id alone (removeMember, updateRole,
-- quit, memberDetail by member_id). This index covers those paths.

CREATE INDEX IF NOT EXISTS idx_workspace_members_member_id
    ON workspace_members(workspace_member_id);

-- ===== 3. Indexes on project_transfers for workspace-scoped queries =====
-- The existing index covers (project_id, transferred_at). These new indexes
-- cover "all transfers from/to workspace X" queries.

CREATE INDEX IF NOT EXISTS idx_project_transfers_source
    ON project_transfers(source_workspace_id, transferred_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_transfers_target
    ON project_transfers(target_workspace_id, transferred_at DESC);

-- ===== 4. Remove FK constraints from project_transfers =====
-- project_transfers is an audit log. Its workspace_id and version_id columns
-- record what happened at a point in time — they must persist even if the
-- referenced workspace or version is later deleted. The ON DELETE NO ACTION
-- FKs currently BLOCK workspace deletion when transfer records exist, which
-- is operationally wrong: an admin should be able to delete a workspace
-- without first scrubbing audit history.

ALTER TABLE project_transfers DROP CONSTRAINT IF EXISTS project_transfers_source_workspace_id_fkey;
ALTER TABLE project_transfers DROP CONSTRAINT IF EXISTS project_transfers_target_workspace_id_fkey;
ALTER TABLE project_transfers DROP CONSTRAINT IF EXISTS project_transfers_version_id_fkey;
