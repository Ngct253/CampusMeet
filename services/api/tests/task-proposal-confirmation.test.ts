import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { Priority, TaskStatus, type ConfirmTaskProposalResponse } from '@campusmeet/shared';
import { createConfirmTaskProposalHandler } from '../src/handlers/task-proposals';
import { apiEvent } from './fixtures';

const result: ConfirmTaskProposalResponse = {
  proposal: {
    proposalId: 'proposal-1',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    title: 'Hoàn thiện bản demo',
    assigneeId: 'user-1',
    priority: Priority.HIGH,
    missingFields: [],
    citations: [
      {
        citationId: 'citation-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        sourceType: 'TRANSCRIPT',
        sourceId: 'transcript-1',
        sourceVersion: 1,
        internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1',
      },
    ],
    status: 'EXECUTED',
    taskId: 'task-1',
  },
  task: {
    id: 'task-1',
    groupId: 'group-1',
    title: 'Hoàn thiện bản demo',
    assigneeId: 'user-1',
    priority: Priority.HIGH,
    status: TaskStatus.TODO,
    sourceMeetingId: 'meeting-1',
  },
};

const eventFor = () => {
  const event = apiEvent('/ai/task-proposals/proposal-1/confirm') as APIGatewayProxyEventV2;
  event.requestContext.http.method = 'POST';
  event.pathParameters = { proposalId: 'proposal-1' };
  event.headers = { 'idempotency-key': 'confirm-key' };
  event.body = JSON.stringify({ assigneeId: 'user-1', priority: Priority.HIGH });
  const context = event.requestContext as typeof event.requestContext & {
    authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
  };
  context.authorizer = { jwt: { claims: { sub: 'admin-1' }, scopes: [] } };
  return event;
};

describe('POST /ai/task-proposals/:proposalId/confirm', () => {
  it('forwards authenticated confirmation and idempotency input', async () => {
    const service = { confirm: vi.fn().mockResolvedValue(result) };
    const response = await createConfirmTaskProposalHandler(service)(
      eventFor(),
      {} as never,
      () => undefined,
    );

    expect(service.confirm).toHaveBeenCalledWith(
      'admin-1',
      'proposal-1',
      { assigneeId: 'user-1', priority: Priority.HIGH },
      'confirm-key',
    );
    expect(response).toMatchObject({ statusCode: 200 });
  });

  it('rejects missing idempotency key before confirmation', async () => {
    const service = { confirm: vi.fn().mockResolvedValue(result) };
    const event = eventFor();
    event.headers = {};
    const response = await createConfirmTaskProposalHandler(service)(
      event,
      {} as never,
      () => undefined,
    );

    expect(response).toMatchObject({ statusCode: 400 });
    expect(service.confirm).not.toHaveBeenCalled();
  });
});
