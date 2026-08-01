import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  Notification,
  NotificationType,
  UpdateProfileRequest,
  UserProfile,
} from '@campusmeet/shared';
import type { AuthContext } from '../middleware/authentication';
import {
  ResourceNotFoundError,
  ServiceConfigurationError,
  UnauthorizedError,
} from '../utils/errors';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';

const cognito = new CognitoIdentityProviderClient({});
const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toProfile = (item: DynamoItem): UserProfile | undefined => {
  const id = stringValue(item, 'id');
  const email = stringValue(item, 'email');
  const displayName = stringValue(item, 'displayName');
  const timezone = stringValue(item, 'timezone');
  if (!id || !email || !displayName || !timezone) return undefined;
  return {
    id,
    email,
    displayName,
    timezone,
    ...(stringValue(item, 'avatarUrl') ? { avatarUrl: stringValue(item, 'avatarUrl') } : {}),
    emailNotificationsEnabled: item.emailNotificationsEnabled !== false,
  };
};

const toNotification = (item: DynamoItem, userId: string): Notification | undefined => {
  const id = stringValue(item, 'id') ?? stringValue(item, 'notificationId');
  const type = stringValue(item, 'type') as NotificationType | undefined;
  const title = stringValue(item, 'title');
  const createdAt = stringValue(item, 'createdAt');
  if (!id || !type || !title || !createdAt) return undefined;
  const storedActionUrl = stringValue(item, 'actionUrl');
  const actionUrl =
    type === 'INVITATION' && id.startsWith('invitation-')
      ? `/app/invitations?invitationId=${encodeURIComponent(id.slice('invitation-'.length))}`
      : storedActionUrl;
  return {
    id,
    userId,
    type,
    title,
    read: item.read === true,
    createdAt,
    ...(actionUrl ? { actionUrl } : {}),
  };
};

async function trustedAttributes(auth: AuthContext) {
  if (!auth.username) throw new UnauthorizedError('JWT không có username Cognito hợp lệ.');
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new ServiceConfigurationError('Thiếu cấu hình USER_POOL_ID.');
  const result = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: auth.username,
    }),
  );
  const attributes = Object.fromEntries(
    (result.UserAttributes ?? []).flatMap(({ Name, Value }) =>
      Name && Value ? [[Name, Value]] : [],
    ),
  );
  const email = attributes.email;
  if (!email || attributes.email_verified !== 'true') {
    throw new UnauthorizedError('Tài khoản cần xác minh email trước khi dùng chức năng nhóm.');
  }
  return {
    email: normalizeEmail(email),
    displayName: attributes.name ?? email.split('@')[0] ?? email,
  };
}

export class DynamoDbIdentityRepository {
  async ensureProfile(auth: AuthContext): Promise<UserProfile> {
    const existing = await documentClient.send(
      new GetCommand({
        TableName: tableName('IDENTITY_TABLE'),
        Key: { PK: `USER#${auth.userId}`, SK: 'PROFILE' },
      }),
    );
    const profile = existing.Item && toProfile(existing.Item);
    if (profile) return profile;

    const identity = await trustedAttributes(auth);
    const created: UserProfile = {
      id: auth.userId,
      email: identity.email,
      displayName:
        (existing.Item && stringValue(existing.Item, 'displayName')) || identity.displayName,
      timezone: (existing.Item && stringValue(existing.Item, 'timezone')) || 'Asia/Ho_Chi_Minh',
      emailNotificationsEnabled: existing.Item?.emailNotificationsEnabled !== false,
    };
    await documentClient.send(
      new PutCommand({
        TableName: tableName('IDENTITY_TABLE'),
        Item: {
          ...existing.Item,
          PK: `USER#${auth.userId}`,
          SK: 'PROFILE',
          entityType: 'USER_PROFILE',
          ...created,
          GSI1PK: `COGNITO#${auth.userId}`,
          GSI1SK: `USER#${auth.userId}`,
          GSI2PK: `EMAIL#${identity.email}`,
          GSI2SK: `USER#${auth.userId}`,
          createdAt: new Date().toISOString(),
        },
      }),
    );
    return created;
  }

  async updateProfile(auth: AuthContext, input: UpdateProfileRequest): Promise<UserProfile> {
    const current = await this.ensureProfile(auth);
    const result = await documentClient.send(
      new UpdateCommand({
        TableName: tableName('IDENTITY_TABLE'),
        Key: { PK: `USER#${auth.userId}`, SK: 'PROFILE' },
        UpdateExpression:
          'SET displayName = :displayName, timezone = :timezone, emailNotificationsEnabled = :emailEnabled, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':displayName': input.displayName,
          ':timezone': input.timezone,
          ':emailEnabled': input.emailNotificationsEnabled,
          ':updatedAt': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toProfile(result.Attributes ?? {}) ?? { ...current, ...input };
  }

  async getProfiles(userIds: string[]): Promise<Map<string, UserProfile>> {
    const profiles = new Map<string, UserProfile>();
    for (let offset = 0; offset < userIds.length; offset += 100) {
      const result = await documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName('IDENTITY_TABLE')]: {
              Keys: userIds
                .slice(offset, offset + 100)
                .map((id) => ({ PK: `USER#${id}`, SK: 'PROFILE' })),
            },
          },
        }),
      );
      for (const item of result.Responses?.[tableName('IDENTITY_TABLE')] ?? []) {
        const profile = toProfile(item);
        if (profile) profiles.set(profile.id, profile);
      }
    }
    return profiles;
  }

  async findUserIdByEmail(email: string): Promise<string | undefined> {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName('IDENTITY_TABLE'),
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :email',
        ExpressionAttributeValues: { ':email': `EMAIL#${normalizeEmail(email)}` },
        Limit: 1,
      }),
    );
    return result.Items?.[0] && stringValue(result.Items[0], 'id');
  }

  async createNotification(notification: Notification): Promise<void> {
    await documentClient.send(
      new PutCommand({
        TableName: tableName('IDENTITY_TABLE'),
        Item: {
          PK: `USER#${notification.userId}`,
          SK: `NOTIFICATION#${notification.createdAt}#${notification.id}`,
          entityType: 'NOTIFICATION',
          ...notification,
          GSI1PK: `NOTIFICATION#${notification.id}`,
          GSI1SK: `USER#${notification.userId}`,
          ...(!notification.read
            ? {
                GSI2PK: `USER#${notification.userId}#UNREAD`,
                GSI2SK: `${notification.createdAt}#${notification.id}`,
              }
            : {}),
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }),
    );
  }

  async listNotifications(userId: string): Promise<Notification[]> {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName('IDENTITY_TABLE'),
        KeyConditionExpression: 'PK = :user AND begins_with(SK, :notification)',
        ExpressionAttributeValues: {
          ':user': `USER#${userId}`,
          ':notification': 'NOTIFICATION#',
        },
        ScanIndexForward: false,
        Limit: 50,
      }),
    );
    return (result.Items ?? []).flatMap((item) => {
      const notification = toNotification(item, userId);
      return notification ? [notification] : [];
    });
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const lookup = await documentClient.send(
      new QueryCommand({
        TableName: tableName('IDENTITY_TABLE'),
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :notification AND GSI1SK = :user',
        ExpressionAttributeValues: {
          ':notification': `NOTIFICATION#${notificationId}`,
          ':user': `USER#${userId}`,
        },
        Limit: 1,
      }),
    );
    const item = lookup.Items?.[0];
    if (!item?.PK || !item.SK) throw new ResourceNotFoundError('Không tìm thấy thông báo.');
    await documentClient.send(
      new UpdateCommand({
        TableName: tableName('IDENTITY_TABLE'),
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: 'SET #read = :true, readAt = :readAt REMOVE GSI2PK, GSI2SK',
        ExpressionAttributeNames: { '#read': 'read' },
        ConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':true': true,
          ':readAt': new Date().toISOString(),
          ':pk': `USER#${userId}`,
        },
      }),
    );
  }
}
