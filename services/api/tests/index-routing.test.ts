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

  it('registers the exact POST Task Proposal confirmation route', async () => {
    const event = apiEvent('/ai/task-proposals/proposal-1/confirm');
    event.requestContext.http.method = 'POST';

    const response = await handler(event, {} as never, () => undefined);

    expect(response).toMatchObject({ statusCode: 401 });
  });
});
