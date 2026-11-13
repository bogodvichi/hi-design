import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../../src/types';
import { completionTime, messageTime } from '../../src/utils/chatTime';

describe('messageTime', () => {
  it('uses assistant startedAt before persisted createdAt', () => {
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Done',
      startedAt: 100,
      createdAt: 200,
      endedAt: 300,
    };

    expect(messageTime(message)).toBe(100);
  });

  it('keeps user createdAt as the primary timestamp', () => {
    const message: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: 'Build this',
      startedAt: 100,
      createdAt: 200,
    };

    expect(messageTime(message)).toBe(200);
  });
});

describe('completionTime', () => {
  it.each([
    ['today', new Date(2026, 10, 13, 9, 5), new Date(2026, 10, 13, 20), '09:05'],
    ['this Wednesday', new Date(2026, 10, 11, 9, 5), new Date(2026, 10, 13), '周三 09:05'],
    ['this Monday', new Date(2026, 10, 9, 9, 5), new Date(2026, 10, 13), '周一 09:05'],
    ['last Sunday', new Date(2026, 10, 8, 9, 5), new Date(2026, 10, 13), '11/08 09:05'],
    ['last week', new Date(2026, 10, 6, 9, 5), new Date(2026, 10, 13), '11/06 09:05'],
    ['Sunday keeps the same week', new Date(2026, 10, 9, 9, 5), new Date(2026, 10, 15), '周一 09:05'],
    ['Monday starts a new week', new Date(2026, 10, 15, 9, 5), new Date(2026, 10, 16), '11/15 09:05'],
    ['week spanning years', new Date(2026, 11, 30, 9, 5), new Date(2027, 0, 1), '周三 09:05'],
    ['next week', new Date(2026, 10, 16, 9, 5), new Date(2026, 10, 13), '11/16 09:05'],
  ] as const)('formats %s in the local calendar', (_label, date, now, expected) => {
    expect(completionTime(date.getTime(), 'zh-CN', now.getTime())).toBe(expected);
  });

  it('localizes weekdays with the interface language', () => {
    expect(completionTime(
      new Date(2026, 10, 11, 9, 5).getTime(), 'en', new Date(2026, 10, 13).getTime(),
    )).toBe('Wed 09:05');
  });
});
