-- Community resource operation statistics.
-- Keeps operational counters out of resources.metadata so statistics do not
-- mutate resource updated_at or interfere with content lifecycle timestamps.

CREATE TABLE IF NOT EXISTS community_resource_stats (
    resource_type       TEXT NOT NULL
                        CHECK (resource_type IN ('project', 'skill', 'mcp', 'tool')),
    resource_id         TEXT NOT NULL,
    preview_count       BIGINT NOT NULL DEFAULT 0 CHECK (preview_count >= 0),
    preview_user_count  BIGINT NOT NULL DEFAULT 0 CHECK (preview_user_count >= 0),
    action_count        BIGINT NOT NULL DEFAULT 0 CHECK (action_count >= 0),
    action_user_count   BIGINT NOT NULL DEFAULT 0 CHECK (action_user_count >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_community_resource_stats_updated
    ON community_resource_stats(updated_at DESC);

CREATE TABLE IF NOT EXISTS community_resource_actor_stats (
    resource_type       TEXT NOT NULL
                        CHECK (resource_type IN ('project', 'skill', 'mcp', 'tool')),
    resource_id         TEXT NOT NULL,
    actor_key           TEXT NOT NULL,
    preview_count       BIGINT NOT NULL DEFAULT 0 CHECK (preview_count >= 0),
    first_preview_at    TIMESTAMPTZ,
    last_preview_at     TIMESTAMPTZ,
    action_count        BIGINT NOT NULL DEFAULT 0 CHECK (action_count >= 0),
    first_action_at     TIMESTAMPTZ,
    last_action_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (resource_type, resource_id, actor_key)
);

CREATE INDEX IF NOT EXISTS idx_community_resource_actor_stats_actor
    ON community_resource_actor_stats(actor_key, updated_at DESC);

