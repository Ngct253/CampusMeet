import { describe, expect, it, vi } from 'vitest';
import { createRouter } from '../src/utils/router';

describe('path-template router', () => {
  it('matches and decodes named path parameters', () => {
    const handler = vi.fn();
    const findRoute = createRouter([
      { method: 'POST', path: '/groups/:groupId/ai/search', handler },
    ]);

    const match = findRoute('POST', '/groups/group%201/ai/search');

    expect(match?.handler).toBe(handler);
    expect(match?.pathParameters).toEqual({ groupId: 'group 1' });
  });

  it('does not match a different method or additional path segment', () => {
    const findRoute = createRouter([
      { method: 'POST', path: '/meetings/:meetingId/ai/chat', handler: vi.fn() },
    ]);

    expect(findRoute('GET', '/meetings/m1/ai/chat')).toBeUndefined();
    expect(findRoute('POST', '/meetings/m1/ai/chat/extra')).toBeUndefined();
  });
});
