-- hdw ResourceHub PostgreSQL schema (hidesign-web)
--
-- This migration creates ONLY the new ResourceHub tables. The existing
-- workspaces and workspace_members tables (managed by the team controller)
-- are reused — new tables reference them by workspace_id / workspace_member_id.
--
-- Design principles:
--   1. Content-addressed blob storage (dedup by digest)
--   2. Versioned resources with ref pointers (published ref)
--   3. Team project catalog for discovery
--   4. Cross-workspace transfer is a metadata operation (blobs never move)

-- ===== Content-Addressed Blob Storage =====
-- Blobs are deduplicated by content digest. Multiple resources/versions can
-- reference the same blob. Storage backend can be S3, local disk, or any
-- object store keyed by digest.

CREATE TABLE IF NOT EXISTS blobs (
    digest       TEXT PRIMARY KEY,          -- sha256 hex
    size         BIGINT NOT NULL,
    storage_path TEXT NOT NULL,             -- relative path under blob dir
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track which workspaces have which blobs (for garbage collection and
-- quota). A blob is only GC'd when no workspace references it.
CREATE TABLE IF NOT EXISTS workspace_blob_refs (
    workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    digest       TEXT NOT NULL REFERENCES blobs(digest) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, digest)
);

CREATE INDEX IF NOT EXISTS idx_workspace_blob_refs_digest
    ON workspace_blob_refs(digest);

-- ===== Resources =====
-- A resource is a versioned, content-addressed tree (e.g. a project's file
-- snapshot). Resources are scoped to a workspace and owned by a member.

CREATE TABLE IF NOT EXISTS resources (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    kind             TEXT NOT NULL DEFAULT 'project',
    owner_member_id  TEXT NOT NULL,          -- references workspace_members.workspace_member_id
    metadata         JSONB,
    deleted_at       TIMESTAMPTZ,            -- soft delete (tombstone)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_workspace
    ON resources(workspace_id, kind, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resources_owner
    ON resources(workspace_id, owner_member_id, updated_at DESC)
    WHERE deleted_at IS NULL;

-- ===== Resource Versions =====
-- Each version is an immutable snapshot: a manifest (list of path+digest
-- entries) stored as a blob itself, plus the blob digests it references.

CREATE TABLE IF NOT EXISTS resource_versions (
    id              TEXT PRIMARY KEY,
    resource_id     TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    manifest_digest TEXT NOT NULL REFERENCES blobs(digest),
    version         INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(resource_id, version)
);

CREATE INDEX IF NOT EXISTS idx_resource_versions_resource
    ON resource_versions(resource_id, version DESC);

-- Track which blobs each version references (for GC and pull manifest).
CREATE TABLE IF NOT EXISTS resource_version_blobs (
    version_id TEXT NOT NULL REFERENCES resource_versions(id) ON DELETE CASCADE,
    digest     TEXT NOT NULL REFERENCES blobs(digest) ON DELETE CASCADE,
    PRIMARY KEY (version_id, digest)
);

-- ===== Resource Refs =====
-- A ref is a movable pointer to a version. The 'published' ref is what
-- members pull. Refs are per-resource.

CREATE TABLE IF NOT EXISTS resource_refs (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    ref         TEXT NOT NULL DEFAULT 'published',
    version_id  TEXT NOT NULL REFERENCES resource_versions(id) ON DELETE CASCADE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (resource_id, ref)
);

-- ===== Team Project Catalog =====
-- Discovery index: which projects are shared in a workspace, who owns them,
-- and what their sync state is.

CREATE TABLE IF NOT EXISTS team_projects (
    id                      TEXT PRIMARY KEY,
    workspace_id            TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    project_id              TEXT NOT NULL,
    resource_id             TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    owner_member_id         TEXT NOT NULL,
    display_name            TEXT,
    cover_digest            TEXT,
    sync_state              TEXT NOT NULL DEFAULT 'pending_upload'
                            CHECK (sync_state IN ('pending_upload', 'syncing', 'synced', 'failed')),
    last_synced_version_id  TEXT REFERENCES resource_versions(id),
    metadata                JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_team_projects_workspace
    ON team_projects(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_projects_owner
    ON team_projects(workspace_id, owner_member_id, updated_at DESC);

-- ===== Pending Blob Uploads =====
-- When a publish arrives with missing blobs, the server creates a pending
-- version. Once all blobs are uploaded, the version is committed and the
-- published ref advances.

CREATE TABLE IF NOT EXISTS pending_version_uploads (
    id              TEXT PRIMARY KEY,
    resource_id     TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    manifest_digest TEXT NOT NULL REFERENCES blobs(digest),
    version         INTEGER NOT NULL,
    missing_digests TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_pending_uploads_resource
    ON pending_version_uploads(resource_id);

CREATE INDEX IF NOT EXISTS idx_pending_uploads_expires
    ON pending_version_uploads(expires_at);

-- ===== Transfer Log =====
-- Audit trail for cross-workspace transfers.

CREATE TABLE IF NOT EXISTS project_transfers (
    id                   TEXT PRIMARY KEY,
    project_id           TEXT NOT NULL,
    source_workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id),
    target_workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id),
    source_resource_id   TEXT NOT NULL,
    target_resource_id   TEXT NOT NULL,
    version_id           TEXT NOT NULL REFERENCES resource_versions(id),
    transferred_by       TEXT NOT NULL,
    transferred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_transfers_project
    ON project_transfers(project_id, transferred_at DESC);

-- ===== updated_at triggers =====

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resources_updated ON resources;
CREATE TRIGGER trg_resources_updated
    BEFORE UPDATE ON resources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_team_projects_updated ON team_projects;
CREATE TRIGGER trg_team_projects_updated
    BEFORE UPDATE ON team_projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_resource_refs_updated ON resource_refs;
CREATE TRIGGER trg_resource_refs_updated
    BEFORE UPDATE ON resource_refs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
