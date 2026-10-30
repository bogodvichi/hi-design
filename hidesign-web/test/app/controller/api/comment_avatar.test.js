'use strict';

const assert = require('assert');
const CommentController = require('../../../../app/controller/api/comment');

function createController(knex) {
  const controller = Object.create(CommentController.prototype);
  controller.ctx = {
    params: { teamId: 'team-1', projectId: 'project-1' },
    query: {},
    request: { body: {} },
    state: {},
    origin: 'https://fallback.test',
    get() {
      return undefined;
    },
    set() {},
  };
  controller.app = {
    config: { community: { publicApiBase: 'https://hdw.example.test' } },
  };
  controller.getKnex = () => knex;
  return controller;
}

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

    const controller = createController(knex);

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

  it('stores the pushed username when a comment is created', async () => {
    const calls = [];
    const knex = table => {
      assert.strictEqual(table, 'workspace_members');
      return {
        where() { return this; },
        first() {
          return Promise.resolve(undefined);
        },
      };
    };
    knex.raw = (sql, bindings) => {
      calls.push({ sql, bindings });
      return Promise.resolve({ rows: [{ seq: 41 }] });
    };

    const controller = createController(knex);
    controller.ctx.request.body = {
      comment: {
        id: 'comment-1',
        memberId: 'member-1',
        username: 'alice',
        displayName: 'Alice',
        note: 'hello',
      },
    };

    await controller.pushComment();

    assert.strictEqual(controller.ctx.body.seq, 41);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual((calls[0].sql.match(/\?/g) || []).length, calls[0].bindings.length);
    assert.match(calls[0].sql, /displayname, username/);
    assert.match(calls[0].sql, /username = COALESCE\(NULLIF\(EXCLUDED\.username, ''\), project_comments\.username\)/);
    assert.ok(calls[0].bindings.includes('alice'));
  });

  it('falls back to the workspace member username for older daemon builds', async () => {
    const calls = [];
    const knex = table => {
      assert.strictEqual(table, 'workspace_members');
      return {
        where() { return this; },
        first() {
          return Promise.resolve({ displayname: 'Alice', username: 'alice' });
        },
      };
    };
    knex.raw = (sql, bindings) => {
      calls.push({ sql, bindings });
      return Promise.resolve({ rows: [{ seq: 42 }] });
    };

    const controller = createController(knex);
    controller.ctx.request.body = {
      comment: {
        id: 'comment-2',
        memberId: 'member-1',
        note: 'hello',
      },
    };

    await controller.pushComment();

    assert.strictEqual(controller.ctx.body.seq, 42);
    assert.strictEqual((calls[0].sql.match(/\?/g) || []).length, calls[0].bindings.length);
    assert.ok(calls[0].bindings.includes('Alice'));
    assert.ok(calls[0].bindings.includes('alice'));
  });

  it('joins comment usernames to publisher profiles and returns the avatar URL', async () => {
    const rawCalls = [];
    const maxSeqQuery = {
      where() { return this; },
      max() { return this; },
      first() { return Promise.resolve({ max_seq: '8' }); },
    };
    const commentsQuery = {
      leftJoin(table, condition) {
        assert.strictEqual(table, 'community_publisher_profiles as cpp');
        condition.call({ on: expression => rawCalls.push(expression) });
        return this;
      },
      where() { return this; },
      orderBy() { return this; },
      select() {
        return Promise.resolve([
          {
            id: 'comment-1',
            project_id: 'project-1',
            conversation_id: 'conversation-1',
            member_id: 'member-1',
            displayname: 'Alice',
            username: 'alice',
            avatar_digest: 'avatar-digest',
            seq: '8',
            note: 'hello',
            file_path: 'index.html',
            element_id: 'hero',
            selector: '#hero',
            label: 'Hero',
            text: 'Hero',
            html_hint: '<div>',
            position: {},
            status: 'open',
            created_at: '1',
            updated_at: '2',
          },
        ]);
      },
    };
    const dispatchKnex = table => {
      if (table === 'project_comments') return maxSeqQuery;
      assert.strictEqual(table, 'project_comments as pc');
      return commentsQuery;
    };
    dispatchKnex.raw = (sql, bindings) => {
      rawCalls.push({ sql, bindings });
      return { sql, bindings };
    };

    const controller = createController(dispatchKnex);
    await controller.pullComments();

    assert.strictEqual(controller.ctx.body.latestSeq, 8);
    assert.strictEqual(controller.ctx.body.comments[0].username, 'alice');
    assert.strictEqual(
      controller.ctx.body.comments[0].avatarUrl,
      'https://hdw.example.test/hdw/api/community/avatar/avatar-digest'
    );
    assert.deepStrictEqual(rawCalls[0].bindings, [ 'pc.username', 'cpp.username' ]);
    assert.match(rawCalls[0].sql, /LOWER/);
  });
});
