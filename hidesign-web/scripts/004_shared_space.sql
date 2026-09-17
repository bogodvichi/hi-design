-- hdw Shared Space schema (hidesign-web)
--
-- The Shared Space is a special global team where every logged-in user is
-- automatically a member (role: 'member'). Projects are NOT copied into the
-- shared space -- instead, a "reference" row in workspace_project_shares
-- projects them onto the shared space for specific recipients.
--
-- Design principles:
--   1. Reference mode: the project stays in its home workspace. The share
--      row is a projection that makes it visible in the shared space.
--   2. Owner exclusion: the sharer cannot see their own shared projects.
--      Only what OTHERS shared TO THEM appears.
--   3. Recipient-scoped: each share row targets specific recipients via
--      recipient_member_id. The list query filters by both shared_space_id
--      AND recipient_member_id.
--   4. Cross-team stable IDs: recipient_member_id and created_by_member_id
--      use the shared-space member ID (deterministic per username), NOT
--      the home workspace's member ID.
--   5. Comments stay on the project: preview_comments are keyed by project_id,
--      so comments made via the shared space are naturally visible to the
--      home workspace. The author_member_id uses a cross-team collaborator ID.

CREATE TABLE IF NOT EXISTS workspace_project_shares (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL,
    home_workspace_id       TEXT NOT NULL,
    shared_space_id         TEXT NOT NULL,
    recipient_member_id     TEXT NOT NULL,
   recipient_username      TEXT NOT NULL,
   created_by_member_id    TEXT,
   created_by_username     TEXT,
   created_by_displayname TEXT,
   created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shares_recipient
    ON workspace_project_shares(shared_space_id, recipient_member_id);

CREATE INDEX IF NOT EXISTS idx_shares_project
    ON workspace_project_shares(project_id);

CREATE INDEX IF NOT EXISTS idx_shares_creator
    ON workspace_project_shares(shared_space_id, created_by_member_id);

-- Grant DML privileges to the application database user.
-- If this script was run as a superuser (e.g. postgres), the table owner
-- is the superuser and the app user (yapovichi) has no implicit privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_project_shares TO yapovichi;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_project_shares TO postgres;
