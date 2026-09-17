-- Add created_by_displayname to workspace_project_shares so the
-- sharedWithMe query can return the sharer's display name without a
-- JOIN to workspace_members. The display name is captured at share
-- time; users do not change their display name.

ALTER TABLE workspace_project_shares
    ADD COLUMN IF NOT EXISTS created_by_displayname TEXT;

-- Backfill existing rows from workspace_members so shares created
-- before this migration also carry a display name.
UPDATE workspace_project_shares AS s
SET created_by_displayname = m.displayname
FROM workspace_members AS m
WHERE m.workspace_member_id = s.created_by_member_id
  AND m.workspace_id = s.shared_space_id
  AND s.created_by_displayname IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_project_shares TO yapovichi;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_project_shares TO postgres;
