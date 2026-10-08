'use strict';

const assert = require('assert');
const ShareLinkController = require('../../../../app/controller/api/share_link');

describe('test/app/controller/api/share_link_avatar.test.js', () => {
  function controller() {
    const instance = Object.create(ShareLinkController.prototype);
    instance.ctx = { origin: 'https://fallback.test' };
    instance.app = {
      config: { community: { publicApiBase: 'https://hdw.example.test' } },
    };
    return instance;
  }

  it('injects the latest avatar map into newly generated share pages', () => {
    const html = '<script>var MEMBER_AVATARS = /*MEMBER_AVATARS_DATA*/{};</script>';
    const rendered = controller()._injectMemberAvatars(html, {
      'member-weng': 'https://hdw.example.test/avatar.jpg',
    });

    assert(rendered.includes('/*MEMBER_AVATARS_DATA*/{"member-weng":"https://hdw.example.test/avatar.jpg"}'));
    assert(!rendered.includes('MutationObserver'));
  });

  it('limits public avatar lookup to members who appear in comments', () => {
    const html = `<script>
      var COMMENTS_DATA = /*COMMENTS_DATA*/[{"id":"one","memberId":"member-weng"},{"id":"two","authorMemberId":"member-weng"},{"id":"three","authorMemberId":"member-zhang"}];
      var MEMBER_AVATARS = /*MEMBER_AVATARS_DATA*/{};
    </script>`;

    assert.deepStrictEqual(controller()._commentMemberIds(html), [ 'member-weng', 'member-zhang' ]);
  });

  it('hydrates avatars in existing share pages without regenerating the link', () => {
    const rendered = controller()._injectMemberAvatars('<html><body>legacy</body></html>', {
      'member-weng': 'https://hdw.example.test/avatar.jpg',
    });

    assert(rendered.includes('MutationObserver'));
    assert(rendered.includes('comment.memberId||comment.authorMemberId'));
    assert(rendered.includes('memberAvatars[memberId(comment)]'));
    assert(rendered.includes('https://hdw.example.test/avatar.jpg'));
    assert(rendered.indexOf('<script>') < rendered.indexOf('</body>'));
  });
});
