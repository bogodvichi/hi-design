-- Comment reply support in project_comments.
--
-- Plan A: keep replies in the same table and carry a self-reference. A reply
-- is just a comment whose parent_id points to another comment in the same
-- team/project. root_comment_id is denormalized to the top-level comment so
-- clients can fetch an entire thread without recursive queries.

ALTER TABLE project_comments
    ADD COLUMN IF NOT EXISTS parent_id TEXT;
ALTER TABLE project_comments
    ADD COLUMN IF NOT EXISTS root_comment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_project_comments_parent
    ON project_comments(team_id, project_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_project_comments_root
    ON project_comments(team_id, project_id, root_comment_id);

-- Backfill root_comment_id for replies that predate this migration: walk one
-- level through the parent, preferring an existing root value on the parent,
-- then the parent's own parent, then the parent itself as the top of the
-- thread. Kept as a plain UPDATE because a recursive CTE would be overkill for
-- the single-level reply shape this migration introduces.
UPDATE project_comments AS c
SET root_comment_id = COALESCE(
    p.root_comment_id,
    p.parent_id,
    p.id
)
FROM project_comments AS p
WHERE c.parent_id IS NOT NULL
  AND c.root_comment_id IS NULL
  AND p.id = c.parent_id;

GRANT SELECT, INSERT, UPDATE, DELETE ON project_comments TO yapovichi;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_comments TO postgres;
