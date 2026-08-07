import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboardHandler } from '../src/handlers/dashboard';
import { DashboardService } from '../src/services/dashboard-service';
import { handler as apiHandler } from '../src/index';
import { apiEvent } from './fixtures';

const eventWithClaims = (claims?: Record<string, unknown>) => {
  const event = apiEvent('/dashboard');
  event.rawQueryString = 'userId=other-user';
  if (claims) {
    const context = event.requestContext as typeof event.requestContext & {
      authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
    };
    context.authorizer = { jwt: { claims, scopes: [] } };
  }
  return event;
};

const invoke = (handler: ReturnType<typeof createDashboardHandler>, event: APIGatewayProxyEventV2) =>
  handler(event, {} as never, () => undefined);

describe('dashboard handler', () => {
  const listByAssignee = vi.fn();
  const dashboardHandler = createDashboardHandler(
    new DashboardService({ listByAssignee }, () => new Date('2026-08-05T10:00:00.000Z')),
  );

  beforeEach(() => listByAssignee.mockReset());

  it('returns the standard 401 envelope when JWT is missing', async () => {
    const response = await invoke(dashboardHandler, eventWithClaims());

    expect(response).toMatchObject({ statusCode: 401 });
    expect(JSON.parse((response as { body: string }).body)).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
      requestId: 'test-request-id',
    });
    expect(listByAssignee).not.toHaveBeenCalled();
  });

  it.each([{ sub: 123 }, { sub: '' }])(
    'returns 401 for malformed authentication claims %#',
    async (claims) => {
      const response = await invoke(dashboardHandler, eventWithClaims(claims));

      expect(response).toMatchObject({ statusCode: 401 });
      expect(listByAssignee).not.toHaveBeenCalled();
    },
  );

  it('uses only JWT sub and returns the success envelope', async () => {
    listByAssignee.mockResolvedValue([]);

    const response = await invoke(
      dashboardHandler,
      eventWithClaims({ sub: 'authenticated-user' }),
    );
    const body = JSON.parse((response as { body: string }).body);

    expect(listByAssignee).toHaveBeenCalledOnce();
    expect(listByAssignee).toHaveBeenCalledWith('authenticated-user');
    expect(body).toEqual({
      success: true,
      data: {
        generatedAt: '2026-08-05T10:00:00.000Z',
        tasks: { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 },
      },
      requestId: 'test-request-id',
    });
  });

  it('returns repository failures through the standard error envelope', async () => {
    const failingHandler = createDashboardHandler(
      new DashboardService({
        listByAssignee: async () => {
          throw new Error('database unavailable');
        },
      }),
    );

    const response = await invoke(failingHandler, eventWithClaims({ sub: 'user-1' }));
    const body = JSON.parse((response as { body: string }).body);

    expect(response).toMatchObject({ statusCode: 500 });
    expect(body).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi nội bộ.' },
      requestId: 'test-request-id',
    });
    expect(JSON.stringify(body)).not.toContain('database unavailable');
  });

  it('does not route non-GET methods to the dashboard handler', async () => {
    const event = eventWithClaims({ sub: 'user-1' });
    event.requestContext.http.method = 'POST';

    const response = await apiHandler(event, {} as never, () => undefined);

    expect(response).toMatchObject({ statusCode: 501 });
    expect(JSON.parse((response as { body: string }).body)).toMatchObject({
      success: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
    expect(listByAssignee).not.toHaveBeenCalled();
  });
});
