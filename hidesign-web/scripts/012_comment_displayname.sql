-- Add displayname to project_comments so comment pulls can return the author's
-- display name without a JOIN to workspace_members. The relay captures the
-- display at push time, mirroring the shared_space/resource_share pattern.

ALTER TABLE project_comments
    ADD COLUMN IF NOT EXISTS displayname TEXT;

-- Backfill existing rows from workspace_members so comments created before
-- this migration also carry a display name. The second UPDATE also repairs
-- rows where an older daemon build wrote the member id into displayname.
UPDATE project_comments AS c
SET displayname = m.displayname
FROM workspace_members AS m
WHERE m.workspace_member_id = c.member_id
  AND m.workspace_id = c.team_id
  AND c.displayname IS NULL;

UPDATE project_comments AS c
SET displayname = m.displayname
FROM workspace_members AS m
WHERE m.workspace_member_id = c.member_id
  AND m.workspace_id = c.team_id
  AND c.displayname = c.member_id;

GRANT SELECT, INSERT, UPDATE, DELETE ON project_comments TO yapovichi;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_comments TO postgres;
