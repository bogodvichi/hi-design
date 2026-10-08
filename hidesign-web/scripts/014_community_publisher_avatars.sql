-- Durable community publisher avatars.
-- The image bytes live in the existing content-addressed blob store; this
-- table keeps one current avatar digest per OA username so historical and new
-- community publications share the same avatar after the publisher logs out.

CREATE TABLE IF NOT EXISTS community_publisher_profiles (
    username        TEXT PRIMARY KEY,
    avatar_digest   TEXT NOT NULL REFERENCES blobs(digest),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_publisher_profiles_avatar
    ON community_publisher_profiles(avatar_digest);
