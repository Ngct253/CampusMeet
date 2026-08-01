import { describe, expect, it } from 'vitest';
import { handler } from '../src/auth-integration';
import { apiEvent } from './fixtures';

describe('M1 browser preflight', () => {
  it('không yêu cầu JWT cho OPTIONS', async () => {
    const event = apiEvent('/groups');
    event.requestContext.http.method = 'OPTIONS';
    const response = await handler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 204 });
  });
});
