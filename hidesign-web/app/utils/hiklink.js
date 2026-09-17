'use strict';

const { randomUUID } = require('node:crypto');

// --- Hiklink OAuth & push config (same as app/bin/hiklink.js) ---
const OAUTH_URL = 'https://hicode-auth-hz.hikvision.com/oauth/token';
const OAUTH_CLIENT_ID = '30615';
const OAUTH_CLIENT_SECRET = 'SXt5wJfV4pTAARkMeA4jcm1faKYbZciFUF8Vmr1zfW50Lo9aryDFgjfrTcvgodT1';

const PUSH_URL = 'https://itapi.hikvision.com/api/';
const CLOUD_API_CLIENT_ID = '30615';
const CLOUD_API_APIKEY = '251008028';
const BIZ_TYPE = 251;
const OFFICIAL_ACCOUNT_ID = '5ec08063-2ea1-4d41-b7c8-c4782faf9301';
const MSG_TYPE = 'TEXT';

function formEncode(params) {
  const sp = new URLSearchParams();
  for (const [ k, val ] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    sp.append(k, String(val));
  }
  return sp;
}

async function fetchOAuthToken() {
  const body = formEncode({
    grant_type: 'client_credentials',
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
  });
  
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }

  if (!res.ok) {
    const err = new Error(`OAuth 失败 HTTP ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  const token = data.access_token;
  if (!token) {
    const err = new Error('OAuth 响应中无 access_token');
    err.body = data;
    throw err;
  }
  return token;
}

/**
 * Send a Hiklink message to a user.
 *
 * @param {string} content  - message text
 * @param {string} username - receiver shortName (lowercase), e.g. 'yebo'
 * @returns {Promise<{ok:boolean,status:number,data:object}>}
 */
async function sendHiklinkMessage(content, username) {
  if (!content) throw new Error('content 不能为空');
  if (!username) throw new Error('username 不能为空');

  const token = await fetchOAuthToken();

  const body = formEncode({
    bizType: BIZ_TYPE,
    bizNo: randomUUID(),
    officialAccountId: OFFICIAL_ACCOUNT_ID,
    receiverUid: username,
    msgType: MSG_TYPE,
    content,
  });

  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-HiCode-Authorization': `Bearer ${token}`,
      'X-CloudApi-ClientId': CLOUD_API_CLIENT_ID,
      'X-CloudApi-ApiKey': CLOUD_API_APIKEY,
    },
    body: body.toString(),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }

  return { ok: res.ok, status: res.status, data };
}

module.exports = {
  sendHiklinkMessage,
};
