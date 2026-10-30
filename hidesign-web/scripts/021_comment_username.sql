-- Persist the comment author's stable login name so reads can join the
-- publisher profile and return a durable avatar URL.
ALTER TABLE project_comments
    ADD COLUMN IF NOT EXISTS username TEXT;

-- Backfill comments written before the column existed. A workspace member id
-- is scoped to its team, so include workspace_id in the lookup.
UPDATE project_comments AS pc
SET username = wm.username
FROM workspace_members AS wm
WHERE wm.workspace_id = pc.team_id
  AND wm.workspace_member_id = pc.member_id
  AND (pc.username IS NULL OR pc.username = '');
