import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  GroupRole,
  InvitationStatus,
  NotificationType,
  type Group,
  type GroupDetails,
  type GroupMember,
  type GroupSummary,
  type InvitationDetails,
  type Membership,
} from '@campusmeet/shared';
import {
  ConflictError,
  ForbiddenError,
  ResourceNotFoundError,
  UnprocessableEntityError,
} from '../utils/errors';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';
import { DynamoDbIdentityRepository } from './identity';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

const toGroup = (item: DynamoItem): Group | undefined => {
  const id = stringValue(item, 'id') ?? stringValue(item, 'PK')?.replace(/^GROUP#/, '');
  const name = stringValue(item, 'name');
  const createdBy = stringValue(item, 'createdBy');
  const createdAt = stringValue(item, 'createdAt');
  if (!id || !name || !createdBy || !createdAt) return undefined;
  return {
    id,
    name,
    ...(stringValue(item, 'description') ? { description: stringValue(item, 'description') } : {}),
    createdBy,
    createdAt,
  };
};

const toMembership = (item: DynamoItem): Membership | undefined => {
  const id = stringValue(item, 'id');
  const groupId = stringValue(item, 'groupId') ?? stringValue(item, 'PK')?.replace(/^GROUP#/, '');
  const userId = stringValue(item, 'userId');
  const role = stringValue(item, 'role') as GroupRole | undefined;
  const joinedAt = stringValue(item, 'joinedAt');
  if (!id || !groupId || !userId || !role || !joinedAt) return undefined;
  return { id, groupId, userId, role, active: item.active !== false, joinedAt };
};

const toInvitation = (item: DynamoItem, groupName: string): InvitationDetails | undefined => {
  const id = stringValue(item, 'id');
  const groupId = stringValue(item, 'groupId');
  const email = stringValue(item, 'email');
  const status = stringValue(item, 'status') as InvitationStatus | undefined;
  const expiresAt = stringValue(item, 'expiresAt');
  const createdAt = stringValue(item, 'createdAt');
  if (!id || !groupId || !email || !status || !expiresAt || !createdAt) return undefined;
  return { id, groupId, groupName, email, status, expiresAt, createdAt };
};

const auditItem = (groupId: string, actorId: string, action: string, resourceId: string) => {
  const occurredAt = new Date().toISOString();
  const id = randomUUID();
  return {
    PK: `GROUP#${groupId}`,
    SK: `AUDIT#${occurredAt}#${id}`,
    entityType: 'AUDIT',
    id,
    actorId,
    action,
    resourceType: action.startsWith('GROUP_') ? 'GROUP' : 'MEMBERSHIP',
    resourceId,
    occurredAt,
  };
};

export class DynamoDbCollaborationRepository {
  constructor(private readonly identities = new DynamoDbIdentityRepository()) {}

  async getMembership(groupId: string, userId: string): Promise<Membership | undefined> {
    const result = await documentClient.send(
      new GetCommand({
        TableName: tableName('COLLABORATION_TABLE'),
        Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
      }),
    );
    const membership = result.Item && toMembership(result.Item);
    return membership?.active ? membership : undefined;
  }

  async getGroup(groupId: string): Promise<Group | undefined> {
    const result = await documentClient.send(
      new GetCommand({
        TableName: tableName('COLLABORATION_TABLE'),
        Key: { PK: `GROUP#${groupId}`, SK: 'META' },
      }),
    );
    return result.Item && toGroup(result.Item);
  }

  async listForUser(userId: string): Promise<GroupSummary[]> {
    const memberships: Membership[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await documentClient.send(
        new QueryCommand({
          TableName: tableName('COLLABORATION_TABLE'),
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :user',
          ExpressionAttributeValues: { ':user': `USER#${userId}` },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      memberships.push(
        ...(page.Items ?? []).flatMap((item) => {
          const membership = toMembership(item);
          return membership?.active ? [membership] : [];
        }),
      );
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    if (!memberships.length) return [];

    const groups = new Map<string, Group>();
    for (let offset = 0; offset < memberships.length; offset += 100) {
      const result = await documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName('COLLABORATION_TABLE')]: {
              Keys: memberships.slice(offset, offset + 100).map(({ groupId }) => ({
                PK: `GROUP#${groupId}`,
                SK: 'META',
              })),
            },
          },
        }),
      );
      for (const item of result.Responses?.[tableName('COLLABORATION_TABLE')] ?? []) {
        const group = toGroup(item);
        if (group) groups.set(group.id, group);
      }
    }

    return memberships.flatMap((membership) => {
      const group = groups.get(membership.groupId);
      return group ? [{ ...group, role: membership.role, joinedAt: membership.joinedAt }] : [];
    });
  }

  async createGroup(
    userId: string,
    input: { name: string; description?: string },
    idempotencyKey: string,
  ): Promise<GroupSummary> {
    const createdAt = new Date().toISOString();
    const groupId = createHash('sha256')
      .update(`${userId}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 32);
    const group: Group = {
      id: groupId,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      createdBy: userId,
      createdAt,
    };
    const membership: Membership = {
      id: `${groupId}:${userId}`,
      groupId,
      userId,
      role: GroupRole.GROUP_ADMIN,
      active: true,
      joinedAt: createdAt,
    };
    try {
      await documentClient.send(
        new TransactWriteCommand({
          ClientRequestToken: groupId,
          TransactItems: [
            {
              Put: {
                TableName: tableName('COLLABORATION_TABLE'),
                Item: {
                  PK: `GROUP#${groupId}`,
                  SK: 'META',
                  entityType: 'GROUP',
                  ...group,
                  adminCount: 1,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: tableName('COLLABORATION_TABLE'),
                Item: {
                  PK: `GROUP#${groupId}`,
                  SK: `MEMBER#${userId}`,
                  entityType: 'MEMBERSHIP',
                  ...membership,
                  GSI1PK: `USER#${userId}`,
                  GSI1SK: `GROUP#${createdAt}#${groupId}`,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: tableName('COLLABORATION_TABLE'),
                Item: auditItem(groupId, userId, 'GROUP_CREATED', groupId),
              },
            },
          ],
        }),
      );
    } catch (error) {
      const existing = await this.getGroup(groupId);
      const existingMembership = await this.getMembership(groupId, userId);
      if (!existing || !existingMembership) throw error;
      return { ...existing, role: existingMembership.role, joinedAt: existingMembership.joinedAt };
    }
    return { ...group, role: membership.role, joinedAt: membership.joinedAt };
  }

  async getDetails(groupId: string, viewerId: string): Promise<GroupDetails> {
    const [group, viewer] = await Promise.all([
      this.getGroup(groupId),
      this.getMembership(groupId, viewerId),
    ]);
    if (!group) throw new ResourceNotFoundError('Không tìm thấy nhóm.');
    if (!viewer) throw new ForbiddenError('Bạn không phải thành viên của nhóm này.');
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName('COLLABORATION_TABLE'),
        KeyConditionExpression: 'PK = :group AND begins_with(SK, :member)',
        ExpressionAttributeValues: { ':group': `GROUP#${groupId}`, ':member': 'MEMBER#' },
      }),
    );
    const memberships = (result.Items ?? []).flatMap((item) => {
      const membership = toMembership(item);
      return membership?.active ? [membership] : [];
    });
    const profiles = await this.identities.getProfiles(memberships.map(({ userId }) => userId));
    const members: GroupMember[] = memberships.map((membership) => {
      const profile = profiles.get(membership.userId);
      return {
        membership,
        ...(profile
          ? { user: { id: profile.id, email: profile.email, displayName: profile.displayName } }
          : {}),
      };
    });
    return { group: { ...group, role: viewer.role, joinedAt: viewer.joinedAt }, members };
  }

  async updateGroup(
    groupId: string,
    actorId: string,
    name: string,
    description: string | undefined,
  ): Promise<Group> {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName('COLLABORATION_TABLE'),
              Key: { PK: `GROUP#${groupId}`, SK: 'META' },
              UpdateExpression:
                'SET #name = :name, description = :description, updatedAt = :updatedAt',
              ExpressionAttributeNames: { '#name': 'name' },
              ExpressionAttributeValues: {
                ':name': name,
                ':description': description ?? '',
                ':updatedAt': new Date().toISOString(),
              },
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
          {
            Put: {
              TableName: tableName('COLLABORATION_TABLE'),
              Item: auditItem(groupId, actorId, 'GROUP_UPDATED', groupId),
            },
          },
        ],
      }),
    );
    const group = await this.getGroup(groupId);
    if (!group) throw new ResourceNotFoundError('Không tìm thấy nhóm.');
    return group;
  }

  async createInvitation(
    groupId: string,
    actorId: string,
    email: string,
    recipientUserId?: string,
  ) {
    const group = await this.getGroup(groupId);
    if (!group) throw new ResourceNotFoundError('Không tìm thấy nhóm.');
    const normalizedEmail = normalizeEmail(email);
    const pending = await documentClient.send(
      new QueryCommand({
        TableName: tableName('COLLABORATION_TABLE'),
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :email AND begins_with(GSI1SK, :invite)',
        ExpressionAttributeValues: { ':email': `EMAIL#${normalizedEmail}`, ':invite': 'INVITE#' },
      }),
    );
    if (
      (pending.Items ?? []).some(
        (item) =>
          stringValue(item, 'groupId') === groupId &&
          stringValue(item, 'status') === InvitationStatus.PENDING &&
          Number(item.expiresAtEpoch) > Math.floor(Date.now() / 1000),
      )
    ) {
      throw new ConflictError('Email này đã có lời mời đang chờ cho nhóm.');
    }
    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const invitation: InvitationDetails = {
      id,
      groupId,
      groupName: group.name,
      email: normalizedEmail,
      status: InvitationStatus.PENDING,
      expiresAt,
      createdAt,
    };
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName('COLLABORATION_TABLE'),
              Item: {
                PK: `GROUP#${groupId}`,
                SK: `INVITE#${id}`,
                entityType: 'INVITATION',
                ...invitation,
                tokenHash: hash,
                invitedBy: actorId,
                expiresAtEpoch: Math.floor(new Date(expiresAt).getTime() / 1000),
                GSI1PK: `EMAIL#${normalizedEmail}`,
                GSI1SK: `INVITE#${expiresAt}#${id}`,
                GSI2PK: `TOKEN#${hash}`,
                GSI2SK: `INVITE#${id}`,
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: tableName('COLLABORATION_TABLE'),
              Item: auditItem(groupId, actorId, 'MEMBERSHIP_INVITED', id),
            },
          },
          ...(recipientUserId
            ? [
                {
                  Put: {
                    TableName: tableName('IDENTITY_TABLE'),
                    Item: {
                      PK: `USER#${recipientUserId}`,
                      SK: `NOTIFICATION#${createdAt}#invitation-${id}`,
                      entityType: 'NOTIFICATION',
                      id: `invitation-${id}`,
                      userId: recipientUserId,
                      type: NotificationType.INVITATION,
                      title: `Bạn được mời tham gia nhóm ${group.name}`,
                      actionUrl: `/app/invitations?invitationId=${id}`,
                      read: false,
                      createdAt,
                      GSI1PK: `NOTIFICATION#invitation-${id}`,
                      GSI1SK: `USER#${recipientUserId}`,
                      GSI2PK: `USER#${recipientUserId}#UNREAD`,
                      GSI2SK: `${createdAt}#invitation-${id}`,
                    },
                    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                  },
                },
              ]
            : []),
        ],
      }),
    );
    return { invitation, inviteToken: token };
  }

  async listInvitations(groupId: string): Promise<InvitationDetails[]> {
    const group = await this.getGroup(groupId);
    if (!group) throw new ResourceNotFoundError('Không tìm thấy nhóm.');
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName('COLLABORATION_TABLE'),
        KeyConditionExpression: 'PK = :group AND begins_with(SK, :invite)',
        ExpressionAttributeValues: { ':group': `GROUP#${groupId}`, ':invite': 'INVITE#' },
        ScanIndexForward: false,
      }),
    );
    return (result.Items ?? []).flatMap((item) => {
      const invitation = toInvitation(item, group.name);
      return invitation ? [invitation] : [];
    });
  }

  async revokeInvitation(groupId: string, invitationId: string, actorId: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      await documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName('COLLABORATION_TABLE'),
                Key: { PK: `GROUP#${groupId}`, SK: `INVITE#${invitationId}` },
                UpdateExpression:
                  'SET #status = :revoked, revokedAt = :now, revokedBy = :actor REMOVE GSI1PK, GSI1SK, GSI2PK, GSI2SK',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':pending': InvitationStatus.PENDING,
                  ':revoked': InvitationStatus.REVOKED,
                  ':now': now,
                  ':actor': actorId,
                  ':expires': Math.floor(Date.now() / 1000),
                },
                ConditionExpression: '#status = :pending AND expiresAtEpoch > :expires',
              },
            },
            {
              Put: {
                TableName: tableName('COLLABORATION_TABLE'),
                Item: auditItem(groupId, actorId, 'INVITATION_REVOKED', invitationId),
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        throw new ConflictError('Lời mời không tồn tại hoặc không còn hiệu lực.');
      }
      throw error;
    }
  }

  async getInvitation(token: string, email: string): Promise<InvitationDetails> {
    const hash = tokenHash(token);
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName('COLLABORATION_TABLE'),
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :token',
        ExpressionAttributeValues: { ':token': `TOKEN#${hash}` },
        Limit: 1,
      }),
    );
    const item = result.Items?.[0];
    if (!item || stringValue(item, 'email') !== normalizeEmail(email)) {
      throw new ResourceNotFoundError('Lời mời không tồn tại hoặc không dành cho tài khoản này.');
    }
    const groupId = stringValue(item, 'groupId');
    const group = groupId && (await this.getGroup(groupId));
    const invitation = group && toInvitation(item, group.name);
    if (!invitation) throw new ResourceNotFoundError('Không tìm thấy lời mời.');
    return invitation;
  }

  async listInvitationsForEmail(email: string): Promise<InvitationDetails[]> {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName('COLLABORATION_TABLE'),
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :email AND begins_with(GSI1SK, :invite)',
        ExpressionAttributeValues: {
          ':email': `EMAIL#${normalizeEmail(email)}`,
          ':invite': 'INVITE#',
        },
        ScanIndexForward: false,
      }),
    );
    const now = Date.now();
    return (result.Items ?? []).flatMap((item) => {
      const groupName = stringValue(item, 'groupName');
      const invitation = groupName && toInvitation(item, groupName);
      return invitation &&
        invitation.status === InvitationStatus.PENDING &&
        new Date(invitation.expiresAt).getTime() > now
        ? [invitation]
        : [];
    });
  }

  async respondInvitation(
    token: string,
    userId: string,
    email: string,
    accept: boolean,
  ): Promise<InvitationDetails> {
    const invitation = await this.getInvitation(token, email);
    return this.respondToInvitation(invitation, userId, accept);
  }

  async respondInvitationById(
    invitationId: string,
    userId: string,
    email: string,
    accept: boolean,
  ): Promise<InvitationDetails> {
    const invitation = (await this.listInvitationsForEmail(email)).find(
      ({ id }) => id === invitationId,
    );
    if (!invitation)
      throw new ResourceNotFoundError('Lời mời không tồn tại hoặc không dành cho tài khoản này.');
    return this.respondToInvitation(invitation, userId, accept);
  }

  private async respondToInvitation(
    invitation: InvitationDetails,
    userId: string,
    accept: boolean,
  ): Promise<InvitationDetails> {
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      throw new UnprocessableEntityError('Lời mời đã hết hạn.');
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      if (accept && invitation.status === InvitationStatus.ACCEPTED) return invitation;
      throw new ConflictError('Lời mời đã được xử lý.');
    }
    const now = new Date().toISOString();
    const membership: Membership = {
      id: `${invitation.groupId}:${userId}`,
      groupId: invitation.groupId,
      userId,
      role: GroupRole.MEMBER,
      active: true,
      joinedAt: now,
    };
    if (accept && (await this.getMembership(invitation.groupId, userId))) {
      throw new ConflictError('Bạn đã là thành viên của nhóm này.');
    }
    const items = [
      {
        Update: {
          TableName: tableName('COLLABORATION_TABLE'),
          Key: { PK: `GROUP#${invitation.groupId}`, SK: `INVITE#${invitation.id}` },
          UpdateExpression:
            'SET #status = :status, respondedAt = :now, respondedBy = :userId REMOVE GSI1PK, GSI1SK',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': accept ? InvitationStatus.ACCEPTED : InvitationStatus.DECLINED,
            ':now': now,
            ':userId': userId,
            ':pending': InvitationStatus.PENDING,
            ':expires': Math.floor(Date.now() / 1000),
          },
          ConditionExpression: '#status = :pending AND expiresAtEpoch > :expires',
        },
      },
      ...(accept
        ? [
            {
              Put: {
                TableName: tableName('COLLABORATION_TABLE'),
                Item: {
                  PK: `GROUP#${invitation.groupId}`,
                  SK: `MEMBER#${userId}`,
                  entityType: 'MEMBERSHIP',
                  ...membership,
                  GSI1PK: `USER#${userId}`,
                  GSI1SK: `GROUP#${now}#${invitation.groupId}`,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
          ]
        : []),
      {
        Put: {
          TableName: tableName('COLLABORATION_TABLE'),
          Item: auditItem(
            invitation.groupId,
            userId,
            accept ? 'MEMBERSHIP_ACCEPTED' : 'MEMBERSHIP_DECLINED',
            invitation.id,
          ),
        },
      },
    ];
    await documentClient.send(new TransactWriteCommand({ TransactItems: items }));
    await this.identities
      .markNotificationRead(userId, `invitation-${invitation.id}`)
      .catch(() => undefined);
    return {
      ...invitation,
      status: accept ? InvitationStatus.ACCEPTED : InvitationStatus.DECLINED,
    };
  }

  async removeMember(groupId: string, actorId: string, userId: string): Promise<void> {
    const membership = await this.getMembership(groupId, userId);
    if (!membership) throw new ResourceNotFoundError('Không tìm thấy thành viên.');
    if (membership.role === GroupRole.GROUP_ADMIN) {
      throw new ConflictError('Không thể xóa Quản trị viên khỏi nhóm.');
    }
    await documentClient
      .send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: tableName('COLLABORATION_TABLE'),
                Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
            {
              Put: {
                TableName: tableName('COLLABORATION_TABLE'),
                Item: auditItem(groupId, actorId, 'MEMBERSHIP_REMOVED', userId),
              },
            },
          ],
        }),
      )
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'TransactionCanceledException') {
          throw new ConflictError('Thành viên đã thay đổi, vui lòng tải lại danh sách.');
        }
        throw error;
      });
  }
}
