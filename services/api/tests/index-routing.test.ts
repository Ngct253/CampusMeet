import { describe, expect, it } from 'vitest';
import { handler } from '../src/index';
import { apiEvent } from './fixtures';

describe('application API routing', () => {
  it('strips a named API Gateway stage before matching routes', async () => {
    const event = apiEvent('/dev/health');
    event.requestContext.stage = 'dev';

    const response = await handler(event, {} as never, () => undefined);

    expect(response).toMatchObject({ statusCode: 200 });
  });
});
