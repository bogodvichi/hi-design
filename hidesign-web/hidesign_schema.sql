-- Schema dump for database: hidesign
-- Host: 10.17.68.13:5432
-- Generated: 2026-09-24T06:05:45.837Z
-- Migration-safe: DROP then CREATE, sequences before tables, constraints after all tables

SET client_encoding = 'UTF8';

-- ============================================================
-- Drop existing tables
-- ============================================================
DROP TABLE IF EXISTS public.workspaces CASCADE;
DROP TABLE IF EXISTS public.workspace_resource_shares CASCADE;
DROP TABLE IF EXISTS public.workspace_project_shares CASCADE;
DROP TABLE IF EXISTS public.workspace_members CASCADE;
DROP TABLE IF EXISTS public.workspace_blob_refs CASCADE;
DROP TABLE IF EXISTS public.team_projects CASCADE;
DROP TABLE IF EXISTS public.share_links CASCADE;
DROP TABLE IF EXISTS public.resources CASCADE;
DROP TABLE IF EXISTS public.resource_versions CASCADE;
DROP TABLE IF EXISTS public.resource_version_blobs CASCADE;
DROP TABLE IF EXISTS public.resource_refs CASCADE;
DROP TABLE IF EXISTS public.project_transfers CASCADE;
DROP TABLE IF EXISTS public.project_comments CASCADE;
DROP TABLE IF EXISTS public.pending_version_uploads CASCADE;
DROP TABLE IF EXISTS public.folders CASCADE;
DROP TABLE IF EXISTS public.folder_shares CASCADE;
DROP TABLE IF EXISTS public.community_resource_stats CASCADE;
DROP TABLE IF EXISTS public.community_resource_actor_stats CASCADE;
DROP TABLE IF EXISTS public.community_plugins CASCADE;
DROP TABLE IF EXISTS public.community_plugin_versions CASCADE;
DROP TABLE IF EXISTS public.blobs CASCADE;

-- ============================================================
-- Sequences
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.project_comments_seq_seq;

-- ============================================================
-- Create tables
-- ============================================================
-- Table: public.blobs
CREATE TABLE public.blobs (
    digest text NOT NULL,
    size bigint NOT NULL,
    storage_path text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT blobs_pkey PRIMARY KEY (digest)
);

-- Table: public.community_plugin_versions
CREATE TABLE public.community_plugin_versions (
    id text NOT NULL,
    plugin_id text NOT NULL,
    version text NOT NULL,
    archive_digest text NOT NULL,
    archive_size bigint NOT NULL,
    archive_integrity text,
    manifest_digest text,
    changelog text,
    deprecated boolean NOT NULL DEFAULT false,
    yanked boolean NOT NULL DEFAULT false,
    yank_reason text,
    yanked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT community_plugin_versions_pkey PRIMARY KEY (id)
);

-- Table: public.community_plugins
CREATE TABLE public.community_plugins (
    id text NOT NULL,
    name text NOT NULL,
    source text NOT NULL DEFAULT 'hdw-community'::text,
    publisher_username text NOT NULL,
    publisher_displayname text,
    publisher_github text,
    publisher_url text,
    homepage text,
    license text,
    title text,
    title_i18n jsonb,
    description text,
    description_i18n jsonb,
    icon text,
    tags text[] NOT NULL DEFAULT '{}'::text[],
    capabilities_summary text[] NOT NULL DEFAULT '{}'::text[],
    prompt text,
    current_version_id text,
    status text NOT NULL DEFAULT 'published'::text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    cover_digest text,
    CONSTRAINT community_plugins_pkey PRIMARY KEY (id)
);

-- Table: public.community_resource_actor_stats
CREATE TABLE public.community_resource_actor_stats (
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    actor_key text NOT NULL,
    preview_count bigint NOT NULL DEFAULT 0,
    first_preview_at timestamp with time zone,
    last_preview_at timestamp with time zone,
    action_count bigint NOT NULL DEFAULT 0,
    first_action_at timestamp with time zone,
    last_action_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT community_resource_actor_stats_pkey PRIMARY KEY (resource_type, resource_id, actor_key)
);

-- Table: public.community_resource_stats
CREATE TABLE public.community_resource_stats (
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    preview_count bigint NOT NULL DEFAULT 0,
    preview_user_count bigint NOT NULL DEFAULT 0,
    action_count bigint NOT NULL DEFAULT 0,
    action_user_count bigint NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT community_resource_stats_pkey PRIMARY KEY (resource_type, resource_id)
);

-- Table: public.folder_shares
CREATE TABLE public.folder_shares (
    folder_id character varying(64) NOT NULL,
    recipient_member_id character varying(64) NOT NULL,
    shared_by_username character varying(255),
    shared_by_member_id character varying(64),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT folder_shares_pkey PRIMARY KEY (folder_id, recipient_member_id)
);

-- Table: public.folders
CREATE TABLE public.folders (
    folder_id character varying(64) NOT NULL DEFAULT gen_random_uuid(),
    folder_pid character varying(64),
    workspace_id character varying(64) NOT NULL,
    folder_name character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    recipient_member_id text,
    CONSTRAINT workspace_folders_pkey PRIMARY KEY (folder_id)
);

-- Table: public.pending_version_uploads
CREATE TABLE public.pending_version_uploads (
    id text NOT NULL,
    resource_id text NOT NULL,
    workspace_id text NOT NULL,
    manifest_digest text NOT NULL,
    version integer NOT NULL,
    missing_digests text[] NOT NULL DEFAULT '{}'::text[],
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL DEFAULT (now() + '01:00:00'::interval),
    CONSTRAINT pending_version_uploads_pkey PRIMARY KEY (id)
);

-- Table: public.project_comments
CREATE TABLE public.project_comments (
    id text NOT NULL,
    team_id text NOT NULL,
    project_id text NOT NULL,
    conversation_id text NOT NULL,
    member_id text NOT NULL,
    seq bigint NOT NULL DEFAULT nextval('project_comments_seq_seq'::regclass),
    note text NOT NULL,
    file_path text NOT NULL,
    element_id text NOT NULL,
    selector text NOT NULL,
    label text NOT NULL,
    text text NOT NULL,
    html_hint text NOT NULL,
    position jsonb NOT NULL,
    style jsonb,
    selection_kind text,
    member_count integer,
    pod_members jsonb,
    slide_index integer,
    attachments jsonb,
    status text NOT NULL,
    anchor_state text,
    anchored_version integer,
    last_good_position jsonb,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    deleted boolean NOT NULL DEFAULT false,
    parent_id text,
    root_comment_id text,
    displayname text,
    CONSTRAINT project_comments_pkey PRIMARY KEY (team_id, project_id, id)
);

-- Table: public.project_transfers
CREATE TABLE public.project_transfers (
    id text NOT NULL,
    project_id text NOT NULL,
    source_workspace_id text NOT NULL,
    target_workspace_id text NOT NULL,
    source_resource_id text NOT NULL,
    target_resource_id text NOT NULL,
    version_id text NOT NULL,
    transferred_by text NOT NULL,
    transferred_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT project_transfers_pkey PRIMARY KEY (id)
);

-- Table: public.resource_refs
CREATE TABLE public.resource_refs (
    resource_id text NOT NULL,
    ref text NOT NULL DEFAULT 'published'::text,
    version_id text NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT resource_refs_pkey PRIMARY KEY (resource_id, ref)
);

-- Table: public.resource_version_blobs
CREATE TABLE public.resource_version_blobs (
    version_id text NOT NULL,
    digest text NOT NULL,
    CONSTRAINT resource_version_blobs_pkey PRIMARY KEY (version_id, digest)
);

-- Table: public.resource_versions
CREATE TABLE public.resource_versions (
    id text NOT NULL,
    resource_id text NOT NULL,
    manifest_digest text NOT NULL,
    version integer NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT resource_versions_pkey PRIMARY KEY (id)
);

-- Table: public.resources
CREATE TABLE public.resources (
    id text NOT NULL,
    workspace_id text NOT NULL,
    kind text NOT NULL DEFAULT 'project'::text,
    owner_member_id text NOT NULL,
    metadata jsonb,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    scope text,
    CONSTRAINT resources_pkey PRIMARY KEY (id)
);

-- Table: public.share_links
CREATE TABLE public.share_links (
    id text NOT NULL,
    token text NOT NULL,
    project_id text NOT NULL,
    workspace_id text NOT NULL,
    resource_id text NOT NULL,
    version_id text NOT NULL,
    html_digest text NOT NULL,
    display_name text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT share_links_pkey PRIMARY KEY (id)
);

-- Table: public.team_projects
CREATE TABLE public.team_projects (
    id text NOT NULL,
    workspace_id text NOT NULL,
    project_id text NOT NULL,
    resource_id text NOT NULL,
    owner_member_id text NOT NULL,
    display_name text,
    sync_state text NOT NULL DEFAULT 'pending_upload'::text,
    last_synced_version_id text,
    metadata jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    cover_digest text,
    folder_id character varying(64),
    CONSTRAINT team_projects_pkey PRIMARY KEY (id)
);

-- Table: public.workspace_blob_refs
CREATE TABLE public.workspace_blob_refs (
    workspace_id text NOT NULL,
    digest text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT workspace_blob_refs_pkey PRIMARY KEY (workspace_id, digest)
);

-- Table: public.workspace_members
CREATE TABLE public.workspace_members (
    workspace_id character varying(64) NOT NULL,
    workspace_member_id character varying(64) NOT NULL,
    username character varying(128) NOT NULL,
    displayname character varying(128),
    email character varying(255),
    role character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, workspace_member_id)
);

-- Table: public.workspace_project_shares
CREATE TABLE public.workspace_project_shares (
    id text NOT NULL DEFAULT gen_random_uuid(),
    project_id text NOT NULL,
    home_workspace_id text NOT NULL,
    shared_space_id text NOT NULL,
    recipient_member_id text NOT NULL,
    recipient_username text NOT NULL,
    created_by_member_id text,
    created_by_username text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    created_by_displayname text,
    folder_id text,
    CONSTRAINT workspace_project_shares_pkey PRIMARY KEY (id)
);

-- Table: public.workspace_resource_shares
CREATE TABLE public.workspace_resource_shares (
    id text NOT NULL,
    resource_id text NOT NULL,
    kind text NOT NULL DEFAULT 'skill'::text,
    home_workspace_id text NOT NULL,
    shared_space_id text NOT NULL,
    recipient_member_id text NOT NULL,
    recipient_username text NOT NULL,
    created_by_member_id text,
    created_by_username text,
    created_by_displayname text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT workspace_resource_shares_pkey PRIMARY KEY (id)
);

-- Table: public.workspaces
CREATE TABLE public.workspaces (
    workspace_id character varying(64) NOT NULL,
    workspace_name character varying(255) NOT NULL,
    owner_username character varying(128) NOT NULL,
    owner_displayname character varying(128),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT workspaces_pkey PRIMARY KEY (workspace_id)
);

-- ============================================================
-- Foreign keys, unique & check constraints
-- ============================================================
ALTER TABLE public.community_plugin_versions ADD CONSTRAINT community_plugin_versions_archive_digest_fkey FOREIGN KEY (archive_digest) REFERENCES blobs(digest);
ALTER TABLE public.community_plugin_versions ADD CONSTRAINT community_plugin_versions_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES community_plugins(id) ON DELETE CASCADE;
ALTER TABLE public.community_plugin_versions ADD CONSTRAINT community_plugin_versions_plugin_id_version_key UNIQUE (plugin_id, version);
ALTER TABLE public.community_plugins ADD CONSTRAINT community_plugins_status_check CHECK ((status = ANY (ARRAY['published'::text, 'unlisted'::text, 'yanked'::text])));
ALTER TABLE public.community_plugins ADD CONSTRAINT community_plugins_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES community_plugin_versions(id) ON DELETE SET NULL;
ALTER TABLE public.community_resource_actor_stats ADD CONSTRAINT community_resource_actor_stats_action_count_check CHECK ((action_count >= 0));
ALTER TABLE public.community_resource_actor_stats ADD CONSTRAINT community_resource_actor_stats_preview_count_check CHECK ((preview_count >= 0));
ALTER TABLE public.community_resource_actor_stats ADD CONSTRAINT community_resource_actor_stats_resource_type_check CHECK ((resource_type = ANY (ARRAY['project'::text, 'skill'::text, 'mcp'::text, 'tool'::text])));
ALTER TABLE public.community_resource_stats ADD CONSTRAINT community_resource_stats_action_count_check CHECK ((action_count >= 0));
ALTER TABLE public.community_resource_stats ADD CONSTRAINT community_resource_stats_action_user_count_check CHECK ((action_user_count >= 0));
ALTER TABLE public.community_resource_stats ADD CONSTRAINT community_resource_stats_preview_count_check CHECK ((preview_count >= 0));
ALTER TABLE public.community_resource_stats ADD CONSTRAINT community_resource_stats_preview_user_count_check CHECK ((preview_user_count >= 0));
ALTER TABLE public.community_resource_stats ADD CONSTRAINT community_resource_stats_resource_type_check CHECK ((resource_type = ANY (ARRAY['project'::text, 'skill'::text, 'mcp'::text, 'tool'::text])));
ALTER TABLE public.folders ADD CONSTRAINT workspace_folders_folder_pid_fkey FOREIGN KEY (folder_pid) REFERENCES folders(folder_id) ON DELETE CASCADE;
ALTER TABLE public.folders ADD CONSTRAINT workspace_folders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE;
ALTER TABLE public.pending_version_uploads ADD CONSTRAINT pending_version_uploads_manifest_digest_fkey FOREIGN KEY (manifest_digest) REFERENCES blobs(digest);
ALTER TABLE public.pending_version_uploads ADD CONSTRAINT pending_version_uploads_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
ALTER TABLE public.pending_version_uploads ADD CONSTRAINT pending_version_uploads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE;
ALTER TABLE public.project_comments ADD CONSTRAINT project_comments_selection_kind_check CHECK ((selection_kind = ANY (ARRAY['element'::text, 'pod'::text])));
ALTER TABLE public.project_comments ADD CONSTRAINT project_comments_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'archived'::text])));
ALTER TABLE public.project_comments ADD CONSTRAINT project_comments_team_id_fkey FOREIGN KEY (team_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE;
ALTER TABLE public.resource_refs ADD CONSTRAINT resource_refs_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
ALTER TABLE public.resource_refs ADD CONSTRAINT resource_refs_version_id_fkey FOREIGN KEY (version_id) REFERENCES resource_versions(id) ON DELETE CASCADE;
ALTER TABLE public.resource_version_blobs ADD CONSTRAINT resource_version_blobs_digest_fkey FOREIGN KEY (digest) REFERENCES blobs(digest) ON DELETE CASCADE;
ALTER TABLE public.resource_version_blobs ADD CONSTRAINT resource_version_blobs_version_id_fkey FOREIGN KEY (version_id) REFERENCES resource_versions(id) ON DELETE CASCADE;
ALTER TABLE public.resource_versions ADD CONSTRAINT resource_versions_manifest_digest_fkey FOREIGN KEY (manifest_digest) REFERENCES blobs(digest);
ALTER TABLE public.resource_versions ADD CONSTRAINT resource_versions_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
ALTER TABLE public.resource_versions ADD CONSTRAINT resource_versions_resource_id_version_key UNIQUE (resource_id, version);
ALTER TABLE public.resources ADD CONSTRAINT resources_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE;
ALTER TABLE public.share_links ADD CONSTRAINT share_links_html_digest_fkey FOREIGN KEY (html_digest) REFERENCES blobs(digest);
ALTER TABLE public.share_links ADD CONSTRAINT share_links_token_key UNIQUE (token);
ALTER TABLE public.team_projects ADD CONSTRAINT team_projects_sync_state_check CHECK ((sync_state = ANY (ARRAY['pending_upload'::text, 'syncing'::text, 'synced'::text, 'failed'::text])));
ALTER TABLE public.team_projects ADD CONSTRAINT team_projects_last_synced_version_id_fkey FOREIGN KEY (last_synced_version_id) REFERENCES resource_versions(id);
ALTER TABLE public.team_projects ADD CONSTRAINT team_projects_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
ALTER TABLE public.team_projects ADD CONSTRAINT team_projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE;
ALTER TABLE public.team_projects ADD CONSTRAINT team_projects_workspace_id_project_id_key UNIQUE (workspace_id, project_id);
ALTER TABLE public.workspace_blob_refs ADD CONSTRAINT workspace_blob_refs_digest_fkey FOREIGN KEY (digest) REFERENCES blobs(digest) ON DELETE CASCADE;
ALTER TABLE public.workspace_blob_refs ADD CONSTRAINT workspace_blob_refs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying, 'guest'::character varying])::text[])));
ALTER TABLE public.workspace_members ADD CONSTRAINT fk_workspace_members_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE;
ALTER TABLE public.workspace_resource_shares ADD CONSTRAINT workspace_resource_shares_kind_check CHECK ((kind = ANY (ARRAY['skill'::text, 'mcp'::text])));
ALTER TABLE public.workspace_resource_shares ADD CONSTRAINT workspace_resource_shares_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_resource_shares ADD CONSTRAINT uq_resource_shares_resource_space_recipient UNIQUE (resource_id, shared_space_id, recipient_member_id);

-- ============================================================
-- Indexes
-- ============================================================
CREATE UNIQUE INDEX community_plugin_versions_plugin_id_version_key ON public.community_plugin_versions USING btree (plugin_id, version);
CREATE INDEX idx_community_plugin_versions_plugin ON public.community_plugin_versions USING btree (plugin_id, created_at DESC);
CREATE UNIQUE INDEX idx_community_plugins_name ON public.community_plugins USING btree (name) WHERE (deleted_at IS NULL);
CREATE INDEX idx_community_plugins_publisher ON public.community_plugins USING btree (publisher_username, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_community_plugins_tags ON public.community_plugins USING gin (tags) WHERE ((deleted_at IS NULL) AND (status = 'published'::text));
CREATE INDEX idx_community_plugins_updated ON public.community_plugins USING btree (updated_at DESC) WHERE ((deleted_at IS NULL) AND (status = 'published'::text));
CREATE INDEX idx_community_resource_actor_stats_actor ON public.community_resource_actor_stats USING btree (actor_key, updated_at DESC);
CREATE INDEX idx_community_resource_stats_updated ON public.community_resource_stats USING btree (updated_at DESC);
CREATE INDEX idx_folder_shares_recipient ON public.folder_shares USING btree (recipient_member_id);
CREATE INDEX idx_pending_uploads_expires ON public.pending_version_uploads USING btree (expires_at);
CREATE INDEX idx_pending_uploads_resource ON public.pending_version_uploads USING btree (resource_id);
CREATE INDEX idx_project_comments_parent ON public.project_comments USING btree (team_id, project_id, parent_id);
CREATE INDEX idx_project_comments_root ON public.project_comments USING btree (team_id, project_id, root_comment_id);
CREATE INDEX idx_project_comments_seq ON public.project_comments USING btree (team_id, project_id, seq);
CREATE INDEX idx_project_transfers_project ON public.project_transfers USING btree (project_id, transferred_at DESC);
CREATE INDEX idx_project_transfers_source ON public.project_transfers USING btree (source_workspace_id, transferred_at DESC);
CREATE INDEX idx_project_transfers_target ON public.project_transfers USING btree (target_workspace_id, transferred_at DESC);
CREATE INDEX idx_resource_versions_resource ON public.resource_versions USING btree (resource_id, version DESC);
CREATE UNIQUE INDEX resource_versions_resource_id_version_key ON public.resource_versions USING btree (resource_id, version);
CREATE INDEX idx_resources_owner ON public.resources USING btree (workspace_id, owner_member_id, updated_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_resources_scope ON public.resources USING btree (workspace_id, kind, scope, updated_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_resources_skill_category ON public.resources USING btree (workspace_id, ((metadata ->> 'category'::text)), updated_at DESC) WHERE ((deleted_at IS NULL) AND (kind = 'skill'::text));
CREATE INDEX idx_resources_workspace ON public.resources USING btree (workspace_id, kind, updated_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_share_links_project ON public.share_links USING btree (workspace_id, project_id);
CREATE INDEX idx_share_links_token ON public.share_links USING btree (token);
CREATE UNIQUE INDEX share_links_token_key ON public.share_links USING btree (token);
CREATE INDEX idx_team_projects_folder_stable ON public.team_projects USING btree (workspace_id, folder_id);
CREATE INDEX idx_team_projects_owner ON public.team_projects USING btree (workspace_id, owner_member_id, updated_at DESC);
CREATE INDEX idx_team_projects_workspace ON public.team_projects USING btree (workspace_id, updated_at DESC);
CREATE UNIQUE INDEX team_projects_workspace_id_project_id_key ON public.team_projects USING btree (workspace_id, project_id);
CREATE INDEX idx_workspace_blob_refs_digest ON public.workspace_blob_refs USING btree (digest);
CREATE INDEX idx_workspace_members_member_id ON public.workspace_members USING btree (workspace_member_id);
CREATE INDEX idx_shares_creator ON public.workspace_project_shares USING btree (shared_space_id, created_by_member_id);
CREATE INDEX idx_shares_project ON public.workspace_project_shares USING btree (project_id);
CREATE INDEX idx_shares_recipient ON public.workspace_project_shares USING btree (shared_space_id, recipient_member_id);
CREATE INDEX idx_resource_shares_creator ON public.workspace_resource_shares USING btree (shared_space_id, created_by_member_id);
CREATE INDEX idx_resource_shares_kind ON public.workspace_resource_shares USING btree (kind, shared_space_id, recipient_member_id);
CREATE INDEX idx_resource_shares_recipient ON public.workspace_resource_shares USING btree (shared_space_id, recipient_member_id);
CREATE INDEX idx_resource_shares_resource ON public.workspace_resource_shares USING btree (resource_id);
CREATE UNIQUE INDEX uq_resource_shares_resource_space_recipient ON public.workspace_resource_shares USING btree (resource_id, shared_space_id, recipient_member_id);

-- ============================================================
-- Comments
-- ============================================================

