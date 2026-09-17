-- Unique constraint on workspace_resource_shares
--
-- Prevents duplicate shares of the same resource to the same person in the
-- same shared space. The combination (resource_id, shared_space_id,
-- recipient_member_id) uniquely identifies "resource X shared to person Y
-- in team Z". Different resources can still be shared to the same person.
--
-- This mirrors the application-level dedup in resource_share.js share()
-- where id = sharedSpaceId_resourceId_username, but enforces it at the
-- database level as a safety net against race conditions and inconsistent
-- id generation.
--
-- Drop first for idempotency, then add.
ALTER TABLE workspace_resource_shares
    DROP CONSTRAINT IF EXISTS uq_resource_shares_resource_space_recipient;
ALTER TABLE workspace_resource_shares
    ADD CONSTRAINT uq_resource_shares_resource_space_recipient
    UNIQUE (resource_id, shared_space_id, recipient_member_id);
