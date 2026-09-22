-- hidesign-stable 建表脚本 (19 张表, 索引均带 _stable 标识)
-- 源: hidesign @ 10.17.68.13:5432 / 合并 001-012 SQL + JS 建表脚本最终状态

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id        VARCHAR(64)  NOT NULL,
    workspace_name      VARCHAR(255) NOT NULL,
    owner_username      VARCHAR(128) NOT NULL,
    owner_displayname   VARCHAR(128),
    owner_email         VARCHAR(255),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id)
);
DROP TRIGGER IF EXISTS trg_workspaces_updated ON workspaces;
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- workspace_members
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id        VARCHAR(64)  NOT NULL,
    workspace_member_id VARCHAR(64)  NOT NULL,
    workspace_name      VARCHAR(255) NOT NULL,
    username            VARCHAR(128) NOT NULL,
    displayname         VARCHAR(128),
    email               VARCHAR(255),
    role                VARCHAR(32)  NOT NULL CHECK (role IN ('owner','admin','member','guest')),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, workspace_member_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_member_id_stable
    ON workspace_members(workspace_member_id);
DROP TRIGGER IF EXISTS trg_workspace_members_updated ON workspace_members;
CREATE TRIGGER trg_workspace_members_updated BEFORE UPDATE ON workspace_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- folders
CREATE TABLE IF NOT EXISTS folders (
    folder_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
    folder_pid       UUID,
    workspace_id     VARCHAR(64)  NOT NULL,
    folder_name      VARCHAR(255) NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (folder_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (folder_pid) REFERENCES folders(folder_id) ON DELETE CASCADE
);

-- folder_projects
CREATE TABLE IF NOT EXISTS folder_projects (
    folder_id        UUID         NOT NULL,
    project_id       VARCHAR(64)  NOT NULL,
    workspace_id     VARCHAR(64)  NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (folder_id, project_id),
    FOREIGN KEY (folder_id) REFERENCES folders(folder_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE
);

-- blobs
CREATE TABLE IF NOT EXISTS blobs (
    digest       TEXT PRIMARY KEY,
    size         BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- workspace_blob_refs
CREATE TABLE IF NOT EXISTS workspace_blob_refs (
    workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    digest       TEXT NOT NULL REFERENCES blobs(digest) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, digest)
);
CREATE INDEX IF NOT EXISTS idx_workspace_blob_refs_digest_stable
    ON workspace_blob_refs(digest);

-- resources
CREATE TABLE IF NOT EXISTS resources (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    kind             TEXT NOT NULL DEFAULT 'project',
    owner_member_id  TEXT NOT NULL,
    metadata         JSONB,
    scope            TEXT,
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resources_workspace_stable
    ON resources(workspace_id, kind, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_resources_owner_stable
    ON resources(workspace_id, owner_member_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_resources_scope_stable
    ON resources(workspace_id, kind, scope, updated_at DESC) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_resources_updated ON resources;
CREATE TRIGGER trg_resources_updated BEFORE UPDATE ON resources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- resource_versions
CREATE TABLE IF NOT EXISTS resource_versions (
    id              TEXT PRIMARY KEY,
    resource_id     TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    manifest_digest TEXT NOT NULL REFERENCES blobs(digest),
    version         INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(resource_id, version)
);
CREATE INDEX IF NOT EXISTS idx_resource_versions_resource_stable
    ON resource_versions(resource_id, version DESC);

-- resource_version_blobs
CREATE TABLE IF NOT EXISTS resource_version_blobs (
    version_id TEXT NOT NULL REFERENCES resource_versions(id) ON DELETE CASCADE,
    digest     TEXT NOT NULL REFERENCES blobs(digest) ON DELETE CASCADE,
    PRIMARY KEY (version_id, digest)
);

-- resource_refs
CREATE TABLE IF NOT EXISTS resource_refs (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    ref         TEXT NOT NULL DEFAULT 'published',
    version_id  TEXT NOT NULL REFERENCES resource_versions(id) ON DELETE CASCADE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (resource_id, ref)
);
DROP TRIGGER IF EXISTS trg_resource_refs_updated ON resource_refs;
CREATE TRIGGER trg_resource_refs_updated BEFORE UPDATE ON resource_refs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- team_projects
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
CREATE INDEX IF NOT EXISTS idx_team_projects_workspace_stable
    ON team_projects(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_projects_owner_stable
    ON team_projects(workspace_id, owner_member_id, updated_at DESC);
DROP TRIGGER IF EXISTS trg_team_projects_updated ON team_projects;
CREATE TRIGGER trg_team_projects_updated BEFORE UPDATE ON team_projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- pending_version_uploads
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
CREATE INDEX IF NOT EXISTS idx_pending_uploads_resource_stable
    ON pending_version_uploads(resource_id);
CREATE INDEX IF NOT EXISTS idx_pending_uploads_expires_stable
    ON pending_version_uploads(expires_at);

-- project_transfers
CREATE TABLE IF NOT EXISTS project_transfers (
    id                   TEXT PRIMARY KEY,
    project_id           TEXT NOT NULL,
    source_workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id),
    target_workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id),
    source_resource_id   TEXT NOT NULL,
    target_resource_id  TEXT NOT NULL,
    version_id           TEXT NOT NULL REFERENCES resource_versions(id),
    transferred_by       TEXT NOT NULL,
    transferred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_transfers_project_stable
    ON project_transfers(project_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_transfers_source_stable
    ON project_transfers(source_workspace_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_transfers_target_stable
    ON project_transfers(target_workspace_id, transferred_at DESC);
-- 审计日志持久化: 移除 FK 约束, 不阻止工作空间删除
ALTER TABLE project_transfers DROP CONSTRAINT IF EXISTS project_transfers_source_workspace_id_fkey;
ALTER TABLE project_transfers DROP CONSTRAINT IF EXISTS project_transfers_target_workspace_id_fkey;
ALTER TABLE project_transfers DROP CONSTRAINT IF EXISTS project_transfers_version_id_fkey;

-- community_plugins
CREATE TABLE IF NOT EXISTS community_plugins (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    source                  TEXT NOT NULL DEFAULT 'hdw-community',
    publisher_username      TEXT NOT NULL,
    publisher_displayname   TEXT,
    publisher_github        TEXT,
    publisher_url           TEXT,
    homepage                TEXT,
    license                 TEXT,
    title                   TEXT,
    title_i18n              JSONB,
    description             TEXT,
    description_i18n        JSONB,
    icon                    TEXT,
    tags                    TEXT[] NOT NULL DEFAULT '{}',
    capabilities_summary    TEXT[] NOT NULL DEFAULT '{}',
    prompt                  TEXT,
    current_version_id      TEXT,
    status                  TEXT NOT NULL DEFAULT 'published'
                            CHECK (status IN ('published', 'unlisted', 'yanked')),
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_plugins_name_stable
    ON community_plugins(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_community_plugins_tags_stable
    ON community_plugins USING GIN (tags)
    WHERE deleted_at IS NULL AND status = 'published';
CREATE INDEX IF NOT EXISTS idx_community_plugins_publisher_stable
    ON community_plugins(publisher_username, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_community_plugins_updated_stable
    ON community_plugins(updated_at DESC)
    WHERE deleted_at IS NULL AND status = 'published';
DROP TRIGGER IF EXISTS trg_community_plugins_updated ON community_plugins;
CREATE TRIGGER trg_community_plugins_updated BEFORE UPDATE ON community_plugins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- community_plugin_versions
CREATE TABLE IF NOT EXISTS community_plugin_versions (
    id                  TEXT PRIMARY KEY,
    plugin_id           TEXT NOT NULL REFERENCES community_plugins(id) ON DELETE CASCADE,
    version             TEXT NOT NULL,
    archive_digest      TEXT NOT NULL REFERENCES blobs(digest),
    archive_size        BIGINT NOT NULL,
    archive_integrity   TEXT,
    manifest_digest     TEXT,
    changelog           TEXT,
    deprecated          BOOLEAN NOT NULL DEFAULT FALSE,
    yanked              BOOLEAN NOT NULL DEFAULT FALSE,
    yank_reason         TEXT,
    yanked_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(plugin_id, version)
);
CREATE INDEX IF NOT EXISTS idx_community_plugin_versions_plugin_stable
    ON community_plugin_versions(plugin_id, created_at DESC);
-- 循环 FK: community_plugins.current_version_id -> community_plugin_versions.id
ALTER TABLE community_plugins
    DROP CONSTRAINT IF EXISTS community_plugins_current_version_id_fkey;
ALTER TABLE community_plugins
    ADD CONSTRAINT community_plugins_current_version_id_fkey
    FOREIGN KEY (current_version_id) REFERENCES community_plugin_versions(id)
    ON DELETE SET NULL;

-- workspace_project_shares
CREATE TABLE IF NOT EXISTS workspace_project_shares (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL,
    home_workspace_id       TEXT NOT NULL,
    shared_space_id         TEXT NOT NULL,
    recipient_member_id     TEXT NOT NULL,
    recipient_username      TEXT NOT NULL,
    created_by_member_id    TEXT,
    created_by_username     TEXT,
    created_by_displayname  TEXT,
    folder_id               UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shares_recipient_stable
    ON workspace_project_shares(shared_space_id, recipient_member_id);
CREATE INDEX IF NOT EXISTS idx_shares_project_stable
    ON workspace_project_shares(project_id);
CREATE INDEX IF NOT EXISTS idx_shares_creator_stable
    ON workspace_project_shares(shared_space_id, created_by_member_id);

-- workspace_resource_shares
CREATE TABLE IF NOT EXISTS workspace_resource_shares (
    id                       TEXT PRIMARY KEY,
    resource_id              TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    kind                      TEXT NOT NULL DEFAULT 'skill'
                             CHECK (kind IN ('skill', 'mcp')),
    home_workspace_id        TEXT NOT NULL,
    shared_space_id          TEXT NOT NULL,
    recipient_member_id      TEXT NOT NULL,
    recipient_username       TEXT NOT NULL,
    created_by_member_id     TEXT,
    created_by_username      TEXT,
    created_by_displayname  TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resource_shares_recipient_stable
    ON workspace_resource_shares(shared_space_id, recipient_member_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_resource_stable
    ON workspace_resource_shares(resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_creator_stable
    ON workspace_resource_shares(shared_space_id, created_by_member_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_kind_stable
    ON workspace_resource_shares(kind, shared_space_id, recipient_member_id);
ALTER TABLE workspace_resource_shares
    DROP CONSTRAINT IF EXISTS uq_resource_shares_resource_space_recipient_stable;
ALTER TABLE workspace_resource_shares
    ADD CONSTRAINT uq_resource_shares_resource_space_recipient_stable
    UNIQUE (resource_id, shared_space_id, recipient_member_id);

-- share_links
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
CREATE INDEX IF NOT EXISTS idx_share_links_project_stable
    ON share_links(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_share_links_token_stable
    ON share_links(token);
DROP TRIGGER IF EXISTS trg_share_links_updated ON share_links;
CREATE TRIGGER trg_share_links_updated BEFORE UPDATE ON share_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- project_comments (由 comment.js INSERT 语句逆向重建; created_at/updated_at 为 epoch 毫秒)
CREATE TABLE IF NOT EXISTS project_comments (
    id                  TEXT NOT NULL,
    team_id             TEXT NOT NULL,
    project_id          TEXT NOT NULL,
    conversation_id     TEXT NOT NULL DEFAULT '',
    member_id           TEXT NOT NULL DEFAULT '',
    displayname         TEXT,
    parent_id           TEXT,
    root_comment_id     TEXT,
    note                TEXT NOT NULL DEFAULT '',
    file_path           TEXT NOT NULL DEFAULT '',
    element_id          TEXT NOT NULL DEFAULT '',
    selector            TEXT NOT NULL DEFAULT '',
    label               TEXT NOT NULL DEFAULT '',
    text                TEXT NOT NULL DEFAULT '',
    html_hint           TEXT NOT NULL DEFAULT '',
    position            JSONB,
    style               JSONB,
    selection_kind      TEXT,
    member_count        INTEGER,
    pod_members         JSONB,
    slide_index         INTEGER,
    attachments         JSONB,
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'resolved', 'archived')),
    anchor_state        TEXT,
    anchored_version    INTEGER,
    last_good_position  JSONB,
    created_at          BIGINT NOT NULL,
    updated_at          BIGINT NOT NULL,
    deleted             BOOLEAN NOT NULL DEFAULT FALSE,
    seq                 BIGSERIAL,
    PRIMARY KEY (team_id, project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_project_comments_parent_stable
    ON project_comments(team_id, project_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_project_comments_root_stable
    ON project_comments(team_id, project_id, root_comment_id);
CREATE INDEX IF NOT EXISTS idx_project_comments_seq_stable
    ON project_comments(team_id, project_id, seq);
