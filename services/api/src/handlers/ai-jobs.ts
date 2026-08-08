import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { aiJobDetailSchema } from '@campusmeet/shared';
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
          'aiJobId, groupId, meetingId, #type, #status, attempt, requestId, provider, inputTokens, outputTokens, estimatedCostUsd, errorCode, createdAt, updatedAt, #result',
        ExpressionAttributeNames: { '#type': 'type', '#status': 'status', '#result': 'result' },
      }),
    );

    if (!result.Item) throw new ResourceNotFoundError('Không tìm thấy AI job.');

    const item = result.Item as Record<string, unknown>;
    const groupId = typeof item.groupId === 'string' ? item.groupId : undefined;
    if (!groupId) throw new ResourceNotFoundError('Không tìm thấy AI job.');

    await requireGroupMembership(userId, groupId);

    const job = aiJobDetailSchema.parse({
      aiJobId: String(item.aiJobId),
      groupId,
      ...(typeof item.meetingId === 'string' ? { meetingId: item.meetingId } : {}),
      type: item.type,
      status: item.status,
      attempt: typeof item.attempt === 'number' ? item.attempt : 0,
      requestId: typeof item.requestId === 'string' ? item.requestId : requestId,
      ...(item.provider ? { provider: item.provider } : {}),
      ...(typeof item.inputTokens === 'number' ? { inputTokens: item.inputTokens } : {}),
      ...(typeof item.outputTokens === 'number' ? { outputTokens: item.outputTokens } : {}),
      ...(typeof item.estimatedCostUsd === 'number'
        ? { estimatedCostUsd: item.estimatedCostUsd }
        : {}),
      ...(typeof item.errorCode === 'string' ? { errorCode: item.errorCode } : {}),
      ...(item.result === undefined ? {} : { result: item.result }),
      createdAt: String(item.createdAt),
      updatedAt: String(item.updatedAt),
    });

    return ok(job, requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};
