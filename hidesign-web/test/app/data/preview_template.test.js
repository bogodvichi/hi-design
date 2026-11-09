'use strict';

const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('test/app/data/preview_template.test.js', () => {
  it('uses the same normalized display-name avatar color as the web app', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');
    const start = template.indexOf("var AVATAR_FALLBACK = 'hsl(210, 65%, 65%)';");
    const end = template.indexOf('// First character of the name', start);

    assert(start >= 0, 'avatar color block should exist');
    assert(end > start, 'avatar color block should have a stable end marker');

    const context = {};
    vm.runInNewContext(template.slice(start, end), context);

    assert.strictEqual(context.avatarColorForDisplayName('张佳雯5'), 'hsl(313, 88%, 46%)');
    assert.strictEqual(
      context.avatarColorForDisplayName('  ＡＬＩＣＥ  '),
      context.avatarColorForDisplayName('alice')
    );
    assert.strictEqual(context.avatarColorForDisplayName(''), 'hsl(210, 65%, 65%)');
    assert(!template.includes('AVATAR_PALETTE'));
    assert(!template.includes('avatarColorFor(authorName)'));
    assert(!template.includes('avatarColorFor(replyAuthorName)'));
  });

  it('renders comment author avatars and shows replies only as a count', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');

    assert(template.includes('var MEMBER_AVATARS = /*MEMBER_AVATARS_DATA*/{};'));
    assert(template.includes('appendCommentAvatar(avatar, comment);'));
    assert(template.includes('appendPopupComment(doc, body, reply, true);'));
    assert(template.includes('comment.authorMemberId || comment.memberId'));
    assert(template.includes('image.onerror = function() { image.remove(); };'));
    assert(template.includes('.comment-avatar > img'));
    assert(template.includes('.comment-card-reply-count'));
    assert(template.includes('replies.length + \' 条回复\''));
    assert(!template.includes('_pinNumber'));
    assert(!template.includes('.comment-pin-num'));
    assert(!template.includes('.comment-replies-container'));
  });

  it('resolves avatars for every comment author before falling back to the member map', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');
    const start = template.indexOf('// avatar-resolution:start');
    const end = template.indexOf('// avatar-resolution:end');

    assert(start >= 0, 'avatar resolution block should exist');
    assert(end > start, 'avatar resolution block should have a stable end marker');

    const context = {
      MEMBER_AVATARS: {
        'member-map': '/avatars/member-map.png',
        'member-author-map': '/avatars/member-author-map.png',
        'member-author-preferred': '/avatars/member-author-preferred.png',
      },
    };
    vm.runInNewContext(template.slice(start, end), context);

    assert.strictEqual(
      context.commentAvatarUrl({
        memberId: 'member-map',
        authorAvatarUrl: '/avatars/comment-author.png',
      }),
      '/avatars/comment-author.png'
    );
    assert.strictEqual(
      context.commentAvatarUrl({ memberId: 'member-map', avatarUrl: '/avatars/comment.png' }),
      '/avatars/comment.png'
    );
    assert.strictEqual(
      context.commentAvatarUrl({ memberId: 'member-map' }),
      '/avatars/member-map.png'
    );
    assert.strictEqual(
      context.commentAvatarUrl({ authorMemberId: 'member-author-map' }),
      '/avatars/member-author-map.png'
    );
    assert.strictEqual(
      context.commentAvatarUrl({
        memberId: 'member-map',
        authorMemberId: 'member-author-preferred',
      }),
      '/avatars/member-author-preferred.png'
    );
    assert.strictEqual(context.commentAvatarUrl({}), '');
  });

  it('counts top-level comments without including replies', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');
    const start = template.indexOf('// comment-count:start');
    const end = template.indexOf('// comment-count:end');

    assert(start >= 0, 'comment count block should exist');
    assert(end > start, 'comment count block should have a stable end marker');

    const context = {};
    vm.runInNewContext(template.slice(start, end), context);
    const comments = [
      { id: 'root-open', status: 'open' },
      { id: 'root-resolved', status: 'resolved' },
      { id: 'reply', parentId: 'root-open', status: 'open' },
      { id: 'nested-reply', parentId: 'reply', status: 'open' },
      null,
    ];

    assert.strictEqual(context.countTopLevelComments(comments), 2);
    assert.strictEqual(context.countTopLevelComments([]), 0);
    assert.strictEqual(context.countTopLevelComments(null), 0);
    assert(context.isTopLevelComment(comments[0]));
    assert(!context.isTopLevelComment(comments[2]));
    assert(template.includes('updateCommentFabBadge(countTopLevelComments(comments));'));
    assert(template.includes('comments.filter(isTopLevelComment)'));
    assert(template.includes("return c.status === 'open' && isTopLevelComment(c);"));
  });

  it('positions page anchors from the current target DOM plus the saved hover offset', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');
    const start = template.indexOf('// pin-point:start');
    const end = template.indexOf('// pin-point:end');

    assert(start >= 0, 'pin point block should exist');
    assert(end > start, 'pin point block should have a stable end marker');

    let rect = { left: 100, top: 50 };
    let selectedSelector = '';
    const target = {
      getBoundingClientRect: () => ({ left: rect.left, top: rect.top }),
    };
    const doc = {
      defaultView: { pageXOffset: 8, pageYOffset: 20 },
      documentElement: { scrollLeft: 0, scrollTop: 0 },
      querySelector: (selector) => {
        selectedSelector = selector;
        return target;
      },
    };
    const context = {};
    vm.runInNewContext(template.slice(start, end), context);

    const comment = {
      selector: '#hero',
      position: { x: 999, y: 888, mx: 12, my: -4 },
    };
    const offsetPoint = context.commentPinPoint(comment, doc);
    assert.strictEqual(selectedSelector, '#hero');
    assert.strictEqual(offsetPoint.x, 120);
    assert.strictEqual(offsetPoint.y, 66);

    rect = { left: 140, top: 75 };
    const movedPoint = context.commentPinPoint(comment, doc);
    assert.strictEqual(movedPoint.x, 160);
    assert.strictEqual(movedPoint.y, 91);

    const invalidSelectorDoc = {
      querySelector: () => {
        throw new Error('invalid selector');
      },
    };
    const fallbackPoint = context.commentPinPoint(comment, invalidSelectorDoc);
    assert.strictEqual(fallbackPoint.x, 1011);
    assert.strictEqual(fallbackPoint.y, 884);

    const basePoint = context.commentPinPoint({ position: { x: 24, y: 18 } }, doc);
    assert.strictEqual(basePoint.x, 24);
    assert.strictEqual(basePoint.y, 18);
    assert.strictEqual(context.commentPinPoint({}), null);
  });

  it('resynchronizes comment anchors when the iframe or window size changes', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');

    assert(template.includes("window.addEventListener('resize', scheduleCommentPinSync);"));
    assert(template.includes("iframe.contentWindow.addEventListener('resize', scheduleCommentPinSync);"));
    assert(template.includes('new ResizeObserver(scheduleCommentPinSync)'));
    assert(template.includes('syncCommentPinPositions(doc, currentFilePath ? getCommentsForPage(currentFilePath) : []);'));
  });

  it('isolates page comment pins and popup styles in a closed shadow root', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');

    assert(template.includes('var commentPinRoots = new WeakMap();'));
    assert(template.includes("container.attachShadow({ mode: 'closed' })"));
    assert(template.includes('commentPinRoots.set(container, pinRoot);'));
    assert(template.includes('pinRoot.appendChild(style);'));
    assert(template.includes('pinRoot.appendChild(pin);'));
    assert(template.includes('var pins = getCommentPins(doc);'));
    assert(template.includes("root.querySelector('.__comment_pin__[data-comment-id=\"' + commentId + '\"]')"));
    assert(!template.includes('doc.head.appendChild(style)'));
    assert(!template.includes("doc.querySelectorAll('.__comment_pin__')"));
  });

  it('keeps comment popups inside the visible iframe area after scrolling', () => {
    const templatePath = path.join(__dirname, '../../../app/data/preview_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');
    const start = template.indexOf('// popup-position:start');
    const end = template.indexOf('// popup-position:end');

    assert(start >= 0, 'popup position block should exist');
    assert(end > start, 'popup position block should have a stable end marker');

    const context = {};
    vm.runInNewContext(template.slice(start, end), context);

    const noScroll = context.commentPopupPosition(
      { x: 700, y: 450 },
      { width: 320, height: 180 },
      { width: 800, height: 600 },
      { x: 0, y: 0 }
    );
    assert.strictEqual(noScroll.left, 358);
    assert.strictEqual(noScroll.top, 286);

    const afterScroll = context.commentPopupPosition(
      { x: 700, y: 1050 },
      { width: 320, height: 180 },
      { width: 800, height: 600 },
      { x: 0, y: 1000 }
    );
    assert.strictEqual(afterScroll.left, 358);
    assert.strictEqual(afterScroll.top, 1038);

    const flippedAtBottom = context.commentPopupPosition(
      { x: 700, y: 1600 },
      { width: 320, height: 180 },
      { width: 800, height: 600 },
      { x: 0, y: 1000 }
    );
    assert.strictEqual(flippedAtBottom.left, 358);
    assert.strictEqual(flippedAtBottom.top, 1408);
  });
});
