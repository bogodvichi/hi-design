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
});
