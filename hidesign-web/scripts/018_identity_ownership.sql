-- Additive prerequisite for workspace authorization. No user/resource IDs are
-- replaced. Apply before the guarded service and review identity-repair.ts's
-- read-only plan. Unresolved personal folder owners require operator review.
BEGIN;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS owner_member_id TEXT;
CREATE INDEX IF NOT EXISTS idx_folders_workspace_owner ON folders(workspace_id, owner_member_id);
COMMIT;
