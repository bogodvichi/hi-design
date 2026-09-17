-- Share Links: generated share-link preview pages for projects.
--
-- A share link is a public-facing preview page that embeds a project''s
-- HTML files in the preview_template.html shell. The generated HTML is
-- stored as a blob (content-addressed) so it deduplicates naturally.
--
-- The share token is a short, URL-safe random ID used in the public
-- route /hdw/share/:token. The project_id + workspace_id pair lets us
-- regenerate or revoke links per project.

CREATE TABLE IF NOT EXISTS share_links (
    id              TEXT PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    project_id      TEXT NOT NULL,
    workspace_id    TEXT NOT NULL,
    resource_id     TEXT NOT NULL,
    version_id      TEXT NOT NULL,
    html_digest     TEXT NOT NULL REFERENCES blobs(digest),
    display_name    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_links_project
    ON share_links(workspace_id, project_id);

CREATE INDEX IF NOT EXISTS idx_share_links_token
    ON share_links(token);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_share_links_updated ON share_links;
CREATE TRIGGER trg_share_links_updated
    BEFORE UPDATE ON share_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
