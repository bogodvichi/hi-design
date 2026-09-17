-- hdw Community Plugin Marketplace schema (hidesign-web)
--
-- This migration creates the community plugin catalog tables. It reuses
-- the existing content-addressed blobs table for archive storage.
--
-- Design principles:
--   1. Plugin entry = marketplace metadata + prompt (the "参考" action
--      reads prompt without downloading the archive)
--   2. Version tracking per plugin (archive_digest, integrity,
--      manifest_digest) for update checking
--   3. Archive stored as a single blob (content-addressed, deduped)
--   4. Tags for Hi广场 type tabs filtering (project/skill/mcp/expert)
--   5. Soft delete on plugins; versions are immutable history
--
-- Relationship to existing tables:
--   blobs                ← reused for archive storage (no new blob table)
--   resources            ← NOT reused (community plugins are global, not
--                           workspace-scoped multi-file snapshots)
--   resource_refs pattern ← simplified to current_version_id column

-- ===== Community Plugins =====
-- One row per published plugin name. This is the marketplace entry that
-- the Hi广场 "项目" tab renders. The prompt column powers the "参考"
-- action (read without download); the archive is fetched separately on
-- "复用" via community_plugin_versions.archive_digest.

CREATE TABLE IF NOT EXISTS community_plugins (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,               -- globally unique plugin name
    source                  TEXT NOT NULL DEFAULT 'hdw-community',
    -- Publisher info (denormalized from SSO session; simple enough to
    -- not warrant a separate publishers table)
    publisher_username      TEXT NOT NULL,
    publisher_displayname   TEXT,
    publisher_github        TEXT,
    publisher_url           TEXT,
    -- Marketplace display metadata
    homepage                TEXT,
    license                 TEXT,
    title                   TEXT,
    title_i18n              JSONB,                        -- { "zh-CN": "...", "en": "..." }
    description             TEXT,
    description_i18n        JSONB,
    icon                    TEXT,                        -- URL or data URI
    tags                    TEXT[] NOT NULL DEFAULT '{}', -- ['project'] | ['skill'] | ['mcp'] | ['expert']
    capabilities_summary    TEXT[] NOT NULL DEFAULT '{}',
    prompt                  TEXT,                        -- "参考" action prompt (read without archive download)
    -- Current version pointer (simplified resource_refs pattern)
    current_version_id      TEXT,                        -- FK → community_plugin_versions.id (set after first version insert)
    -- Lifecycle
    status                  TEXT NOT NULL DEFAULT 'published'
                            CHECK (status IN ('published', 'unlisted', 'yanked')),
    deleted_at              TIMESTAMPTZ,                 -- soft delete (tombstone)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- NOTE: current_version_id FK is added after community_plugin_versions
    -- is created (circular dependency).
);

-- Unique name among non-deleted plugins. Soft-deleted names can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_plugins_name
    ON community_plugins(name)
    WHERE deleted_at IS NULL;

-- GIN index on tags for type-tab filtering (WHERE tags @> ARRAY['project']).
CREATE INDEX IF NOT EXISTS idx_community_plugins_tags
    ON community_plugins USING GIN (tags)
    WHERE deleted_at IS NULL AND status = 'published';

-- Publisher's plugins listing.
CREATE INDEX IF NOT EXISTS idx_community_plugins_publisher
    ON community_plugins(publisher_username, created_at DESC)
    WHERE deleted_at IS NULL;

-- Recent plugins for marketplace landing (ordered by updated_at DESC).
CREATE INDEX IF NOT EXISTS idx_community_plugins_updated
    ON community_plugins(updated_at DESC)
    WHERE deleted_at IS NULL AND status = 'published';

-- ===== Community Plugin Versions =====
-- Immutable version history. Each version points to an archive blob
-- (content-addressed, deduped across versions/plugins). The daemon
-- compares manifest_digest / integrity to detect updates.

CREATE TABLE IF NOT EXISTS community_plugin_versions (
    id                  TEXT PRIMARY KEY,
    plugin_id           TEXT NOT NULL REFERENCES community_plugins(id) ON DELETE CASCADE,
    version             TEXT NOT NULL,                 -- semver "1.0.0"
    -- Archive blob (content-addressed). ON DELETE NO ACTION (default)
    -- prevents blob deletion while a version references it.
    archive_digest      TEXT NOT NULL REFERENCES blobs(digest),
    archive_size        BIGINT NOT NULL,               -- bytes
    archive_integrity   TEXT,                           -- "sha256-<hex>" for subresource integrity
    manifest_digest     TEXT,                           -- sha256 of plugin manifest JSON (update checking)
    changelog           TEXT,                           -- release notes
    -- Lifecycle
    deprecated          BOOLEAN NOT NULL DEFAULT FALSE,
    yanked              BOOLEAN NOT NULL DEFAULT FALSE,
    yank_reason         TEXT,
    yanked_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(plugin_id, version)
);

CREATE INDEX IF NOT EXISTS idx_community_plugin_versions_plugin
    ON community_plugin_versions(plugin_id, created_at DESC);

-- Circular FK: community_plugins.current_version_id → community_plugin_versions.id
-- Added after both tables exist. ON DELETE SET NULL so deleting a version
-- (rare) doesn't cascade-delete the plugin; the plugin just loses its pointer.
ALTER TABLE community_plugins
    ADD CONSTRAINT community_plugins_current_version_id_fkey
    FOREIGN KEY (current_version_id)
    REFERENCES community_plugin_versions(id)
    ON DELETE SET NULL;

-- ===== updated_at trigger =====

DROP TRIGGER IF EXISTS trg_community_plugins_updated ON community_plugins;
CREATE TRIGGER trg_community_plugins_updated
    BEFORE UPDATE ON community_plugins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
