import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { documentClient, stringValue, tableName } from './client';

export interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scope?: string;
}

export class GoogleIntegrationRepository {
  async getTokens(userId: string): Promise<GoogleOAuthTokens | undefined> {
    const result = await documentClient.send(new GetCommand({
      TableName: tableName('IDENTITY_TABLE'),
      Key: { PK: `USER#${userId}`, SK: 'INTEGRATION#GOOGLE' },
      ConsistentRead: true,
    }));
    const item = result.Item;
    if (!item) return undefined;
    const accessToken = stringValue(item, 'accessToken');
    const expiresAt = stringValue(item, 'expiresAt');
    if (!accessToken || !expiresAt) return undefined;
    const refreshToken = stringValue(item, 'refreshToken');
    const scope = stringValue(item, 'scope');
    return {
      accessToken,
      expiresAt,
      ...(refreshToken ? { refreshToken } : {}),
      ...(scope ? { scope } : {}),
    };
  }

  async createState(stateHash: string, userId: string, expiresAtEpoch: number): Promise<void> {
    await documentClient.send(new PutCommand({
      TableName: tableName('IDENTITY_TABLE'),
      Item: {
        PK: `OAUTH_STATE#${stateHash}`,
        SK: 'GOOGLE',
        entityType: 'GOOGLE_OAUTH_STATE',
        userId,
        expiresAt: expiresAtEpoch,
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  }

  async consumeState(stateHash: string, nowEpoch: number): Promise<string | undefined> {
    const key = { PK: `OAUTH_STATE#${stateHash}`, SK: 'GOOGLE' };
    const result = await documentClient.send(new GetCommand({
      TableName: tableName('IDENTITY_TABLE'),
      Key: key,
      ConsistentRead: true,
    }));
    await documentClient.send(new DeleteCommand({
      TableName: tableName('IDENTITY_TABLE'),
      Key: key,
    }));
    const userId = result.Item && stringValue(result.Item, 'userId');
    const expiresAt = typeof result.Item?.expiresAt === 'number' ? result.Item.expiresAt : 0;
    return userId && expiresAt >= nowEpoch ? userId : undefined;
  }

  async saveTokens(userId: string, tokens: GoogleOAuthTokens): Promise<void> {
    await documentClient.send(new PutCommand({
      TableName: tableName('IDENTITY_TABLE'),
      Item: {
        PK: `USER#${userId}`,
        SK: 'INTEGRATION#GOOGLE',
        entityType: 'GOOGLE_INTEGRATION',
        provider: 'GOOGLE',
        status: 'READY',
        ...tokens,
        updatedAt: new Date().toISOString(),
      },
    }));
  }
}
