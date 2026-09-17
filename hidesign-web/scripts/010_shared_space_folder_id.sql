-- Add folder_id to workspace_project_shares so batch-shared projects
-- can record which cloud folder they belong to. Set by the
-- /shared-space/share-batch endpoint when sharing a folder's projects.
--
-- The folder_id is a UUID referencing the folders table. It is nullable
-- because single-project shares (via /shared-space/share) do not carry
-- a folder_id, and existing rows predate this column.

ALTER TABLE workspace_project_shares
    ADD COLUMN IF NOT EXISTS folder_id UUID;

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_project_shares TO yapovichi;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_project_shares TO postgres;
