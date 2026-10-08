'use strict';

const assert = require('assert');
const CommunityController = require('../../../../app/controller/api/community');

describe('test/app/controller/api/community_avatar.test.js', () => {
  it('exposes the persisted publisher avatar on marketplace entries', () => {
    const controller = Object.create(CommunityController.prototype);
    controller._archiveUrl = (name, version) => `/archive/${name}/${version}`;
    controller._avatarUrl = digest => `/avatar/${digest}`;
    controller._coverUrl = digest => `/cover/${digest}`;

    const entry = controller._toMarketplaceEntry({
      id: 'plugin-id',
      name: 'community-project',
      source: 'hdw-community',
      publisher_username: 'alice',
      publisher_displayname: 'Alice',
      publisher_avatar_digest: 'avatar-digest',
      cv_version: '0.0.0',
      cv_created_at: new Date('2026-09-28T00:00:00.000Z'),
      tags: [ 'project' ],
      capabilities_summary: [],
    });

    assert.strictEqual(entry.publisher.id, 'alice');
    assert.strictEqual(entry.publisher.avatarUrl, '/avatar/avatar-digest');
  });
});
