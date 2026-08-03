import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { AIJob } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { requireGroupMembership } from '../middleware/authorization';
import { handleError } from '../middleware/error-handler';
import { documentClient } from '../repositories/client';
import { ResourceNotFoundError, ServiceConfigurationError } from '../utils/errors';
import { getPathParameter, getRequestId } from '../utils/request';
import { ok } from '../utils/response';

const aiWorkTable = (): string => {
  const value = process.env.AI_WORK_TABLE;
  if (!value) throw new ServiceConfigurationError('Thiếu cấu hình AI_WORK_TABLE.');
  return value;
};

export const aiJobDetailHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    const aiJobId = getPathParameter(event, 'aiJobId');

    const result = await documentClient.send(
      new GetCommand({
        TableName: aiWorkTable(),
        Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
        ConsistentRead: true,
        ProjectionExpression:
          'aiJobId, groupId, meetingId, #type, #status, attempt, requestId, provider, errorCode, createdAt, updatedAt',
        ExpressionAttributeNames: { '#type': 'type', '#status': 'status' },
      }),
    );

    if (!result.Item) throw new ResourceNotFoundError('Không tìm thấy AI job.');

    const item = result.Item as Record<string, unknown>;
    const groupId = typeof item.groupId === 'string' ? item.groupId : undefined;
    if (!groupId) throw new ResourceNotFoundError('Không tìm thấy AI job.');

    await requireGroupMembership(userId, groupId);

    const job: AIJob = {
      aiJobId: String(item.aiJobId),
      groupId,
      ...(typeof item.meetingId === 'string' ? { meetingId: item.meetingId } : {}),
      type: item.type as AIJob['type'],
      status: item.status as AIJob['status'],
      attempt: typeof item.attempt === 'number' ? item.attempt : 0,
      requestId: typeof item.requestId === 'string' ? item.requestId : requestId,
      ...(item.provider ? { provider: item.provider as AIJob['provider'] } : {}),
      ...(typeof item.errorCode === 'string' ? { errorCode: item.errorCode } : {}),
      createdAt: String(item.createdAt),
      updatedAt: String(item.updatedAt),
    };

    return ok(job, requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};
