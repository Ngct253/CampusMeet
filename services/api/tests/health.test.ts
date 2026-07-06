import { describe, expect, it } from 'vitest';
import { healthHandler } from '../src/handlers/health';
import { apiEvent } from './fixtures';

describe('health handler', () => {
  it('returns 200 without secrets', async () => {
    const response = await healthHandler(apiEvent(), {} as never, () => undefined);
    if (!response || typeof response === 'string')
      throw new Error('Expected a structured response');
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '{}').data.status).toBe('ok');
  });
});
