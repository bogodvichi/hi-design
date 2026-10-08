'use strict';

const assert = require('assert');
const CommentController = require('../../../../app/controller/api/comment');

describe('test/app/controller/api/comment_avatar.test.js', () => {
  it('returns durable profile avatars in the team member directory', async () => {
    const rows = [
      {
        workspace_member_id: 'member-weng',
        displayname: '翁文秀',
        role: 'member',
        avatar_digest: 'avatar-digest',
      },
      {
        workspace_member_id: 'member-zhang',
        displayname: '张佳雯5',
        role: 'member',
        avatar_digest: null,
      },
    ];
    const query = {
      leftJoin() { return this; },
      where() { return this; },
      select() { return this; },
      orderBy() { return Promise.resolve(rows); },
    };
    const knex = table => {
      assert.strictEqual(table, 'workspace_members as wm');
      return query;
    };
    knex.raw = () => ({ sql: 'lower username join' });

    const controller = Object.create(CommentController.prototype);
    controller.ctx = { params: { teamId: 'team-1' }, origin: 'https://fallback.test' };
    controller.app = {
      config: { community: { publicApiBase: 'https://hdw.example.test' } },
    };
    controller.getKnex = () => knex;

    await controller.listMembers();

    assert.deepStrictEqual(controller.ctx.body, {
      members: [
        {
          memberId: 'member-weng',
          displayName: '翁文秀',
          role: 'member',
          avatarUrl: 'https://hdw.example.test/hdw/api/community/avatar/avatar-digest',
        },
        {
          memberId: 'member-zhang',
          displayName: '张佳雯5',
          role: 'member',
          avatarUrl: null,
        },
      ],
    });
  });
});
