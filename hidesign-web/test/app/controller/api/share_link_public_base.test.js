'use strict';

const assert = require('assert');
const ShareLinkController = require('../../../../app/controller/api/share_link');

describe('test/app/controller/api/share_link_public_base.test.js', () => {
  function controller() {
    const instance = Object.create(ShareLinkController.prototype);
    instance.ctx = {
      origin: 'https://fallback.test',
      query: {},
      request: { body: {} },
      logger: { error() {} },
    };
    instance.app = {
      config: { community: { publicApiBase: 'https://configured.test/hdw-root' } },
    };
    return instance;
  }

  it('prefers a valid request base and normalizes its trailing slashes', () => {
    assert.strictEqual(
      controller()._publicBase('https://dynamic.test/share-root///'),
      'https://dynamic.test/share-root'
    );
  });

  it('falls back to the configured base for unsafe or malformed request bases', () => {
    const instance = controller();
    const invalidBases = [
      'ftp://dynamic.test/path',
      'https://dynamic.test/path?query=1',
      'https://dynamic.test/path#fragment',
      'https://user:password@dynamic.test/path',
      'not a url',
    ];

    for (const publicBase of invalidBases) {
      assert.strictEqual(
        instance._publicBase(publicBase),
        'https://configured.test/hdw-root',
        publicBase
      );
    }
  });

  it('builds the returned existing-link URL from the request base', async () => {
    const instance = controller();
    const query = {
      where() { return this; },
      first() {
        return Promise.resolve({
          token: 'existing-token',
          display_name: 'Existing project',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-02T00:00:00.000Z'),
        });
      },
    };
    instance.getKnex = () => table => {
      assert.strictEqual(table, 'share_links');
      return query;
    };
    instance.ctx.query = {
      project_id: 'project-1',
      public_base: 'https://dynamic.test/share-root/',
    };

    await instance.get();

    assert.strictEqual(
      instance.ctx.body.data.url,
      'https://dynamic.test/share-root/hdw/share/existing-token'
    );
  });

  it('keeps avatar URLs relative to the share page mount', () => {
    assert.strictEqual(
      controller()._avatarUrl('avatar-digest'),
      '../api/community/avatar/avatar-digest'
    );
  });
});
