-- Add scope column to resources table.
--
-- The resource create() and publish() controllers write a `scope` value
-- (e.g. 'private', 'public') to distinguish personal-scope resources
-- from community-published ones. Without this column the INSERT fails
-- silently inside a try/catch, so MCP/skill/tool cloud publishes never
-- reach the resources table.

ALTER TABLE resources
    ADD COLUMN IF NOT EXISTS scope TEXT;

-- Index for filtering by scope (community browse uses
-- WHERE scope = 'public'; personal list uses WHERE scope IS NULL).
CREATE INDEX IF NOT EXISTS idx_resources_scope
    ON resources(workspace_id, kind, scope, updated_at DESC)
    WHERE deleted_at IS NULL;
