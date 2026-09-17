'use strict';

const assert = require('assert');
const { serializeOASessionCookies } = require('../../../app/utils/oa-session-cookies');

describe('test/app/utils/oa_session_cookies.test.js', () => {
  it('serializes structured OA cookies without accepting domains from the caller', () => {
    assert.strictEqual(serializeOASessionCookies([
      { name: 'JwtToken', value: 'opaque-token', domain: 'ignored.example' },
      { name: 'SESSION', value: 'opaque-session' },
    ]), 'JwtToken=opaque-token; SESSION=opaque-session');
  });

  it('rejects malformed cookie names and values', () => {
    assert.strictEqual(serializeOASessionCookies([
      { name: 'bad name', value: 'opaque' },
    ]), '');
    assert.strictEqual(serializeOASessionCookies([
      { name: 'SESSION', value: 'opaque; injected=true' },
    ]), '');
  });
});
