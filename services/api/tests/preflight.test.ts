import { describe, expect, it } from 'vitest';
import { handler } from '../src/index';
import { apiEvent } from './fixtures';

describe('API preflight', () => {
  it('returns 204 before protected ANY routes authenticate', async () => {
    const event = apiEvent('/me');
    event.requestContext.http.method = 'OPTIONS';

    const response = await handler(event, {} as never, () => undefined);

    expect(response).toEqual({ statusCode: 204 });
  });
});
