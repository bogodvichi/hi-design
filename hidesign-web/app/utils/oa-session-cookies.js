'use strict';

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
const MAX_COOKIE_VALUE_LENGTH = 8192;
const MAX_COOKIE_HEADER_LENGTH = 32768;
const MAX_COOKIE_COUNT = 64;

function hasInvalidCookieValue(value) {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === ';' || code <= 31 || code === 127) return true;
  }
  return false;
}

function serializeOASessionCookies(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COOKIE_COUNT) return '';

  const parts = [];
  for (const cookie of value) {
    if (!cookie || typeof cookie !== 'object') return '';
    const name = typeof cookie.name === 'string' ? cookie.name : '';
    const cookieValue = typeof cookie.value === 'string' ? cookie.value : '';
    if (
      !COOKIE_NAME_PATTERN.test(name)
      || cookieValue.length > MAX_COOKIE_VALUE_LENGTH
      || hasInvalidCookieValue(cookieValue)
    ) {
      return '';
    }
    parts.push(`${name}=${cookieValue}`);
  }

  const header = parts.join('; ');
  return header.length <= MAX_COOKIE_HEADER_LENGTH ? header : '';
}

module.exports = { serializeOASessionCookies };
