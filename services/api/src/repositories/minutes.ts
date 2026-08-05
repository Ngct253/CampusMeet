import { randomUUID } from 'node:crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  ActionItem,
  Decision,
  Meeting,
  MeetingMinutes,
  UpdateMeetingMinutesRequest,
} from '@campusmeet/shared';
import type { MinutesRepository } from '../domain/ports';
import { ConflictError } from '../utils/errors';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';

const MINUTES_SK_PREFIX = 'MINUTES#VERSION#';
const MAX_MINUTES_VERSION = 999999;
const MINUTES_SK_PATTERN = /^MINUTES#VERSION#(\d{6})$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

const numberValue = (item: DynamoItem, key: string) =>
  typeof item[key] === 'number' ? item[key] : undefined;

const isIsoDateTime = (value: string) => {
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHourText, offsetMinuteText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (
    zone !== 'Z' &&
    (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)
  ) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
};

const decisionsValue = (value: unknown): Decision[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const decisions = value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const item = entry as DynamoItem;
    const id = stringValue(item, 'id');
    const content = stringValue(item, 'content');
    return id && content ? [{ id, content }] : [];
  });
  return decisions.length === value.length ? decisions : undefined;
};

const actionItemsValue = (value: unknown): ActionItem[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const actionItems = value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const item = entry as DynamoItem;
    const id = stringValue(item, 'id');
    const content = stringValue(item, 'content');
    if (!id || !content) return [];
    const assigneeId = stringValue(item, 'assigneeId');
    const taskId = stringValue(item, 'taskId');
    return [{ id, content, ...(assigneeId ? { assigneeId } : {}), ...(taskId ? { taskId } : {}) }];
  });
  return actionItems.length === value.length ? actionItems : undefined;
};

const toMinutes = (item: DynamoItem, expectedMeetingId: string): MeetingMinutes => {
  const pk = stringValue(item, 'PK');
  const sk = stringValue(item, 'SK');
  const entityType = stringValue(item, 'entityType');
  const id = stringValue(item, 'id');
  const meetingId = stringValue(item, 'meetingId');
  const groupId = stringValue(item, 'groupId');
  const summary = stringValue(item, 'summary');
  const discussion = stringValue(item, 'discussion');
  const decisions = decisionsValue(item.decisions);
  const actionItems = actionItemsValue(item.actionItems);
  const version = numberValue(item, 'version');
  const createdBy = stringValue(item, 'createdBy');
  const createdAt = stringValue(item, 'createdAt');
  const versionFromSortKey = sk ? MINUTES_SK_PATTERN.exec(sk)?.[1] : undefined;
  if (
    entityType !== 'MEETING_MINUTES' ||
    pk !== `MEETING#${expectedMeetingId}` ||
    versionFromSortKey === undefined ||
    !id ||
    meetingId !== expectedMeetingId ||
    !groupId ||
    !summary ||
    discussion === undefined ||
    !decisions ||
    !actionItems ||
    version === undefined ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > MAX_MINUTES_VERSION ||
    Number(versionFromSortKey) !== version ||
    !createdBy ||
    !createdAt ||
    !isIsoDateTime(createdAt)
  ) {
    throw new Error('Malformed meeting minutes item.');
  }
  return {
    id,
    meetingId,
    groupId,
    summary,
    discussion,
    decisions,
    actionItems,
    version,
    createdBy,
    createdAt,
  };
};

const minutesSortKey = (version: number) =>
  `${MINUTES_SK_PREFIX}${String(version).padStart(6, '0')}`;

export class DynamoDbMinutesRepository implements MinutesRepository {
  async getLatest(meetingId: string): Promise<MeetingMinutes | null> {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName('MEETING_DATA_TABLE'),
        KeyConditionExpression: 'PK = :meeting AND begins_with(SK, :minutes)',
        ExpressionAttributeValues: {
          ':meeting': `MEETING#${meetingId}`,
          ':minutes': MINUTES_SK_PREFIX,
        },
        ScanIndexForward: false,
        Limit: 1,
        ConsistentRead: true,
      }),
    );
    const item = result.Items?.[0];
    return item ? toMinutes(item, meetingId) : null;
  }

  async createVersion(
    meeting: Meeting,
    actorId: string,
    input: UpdateMeetingMinutesRequest,
    nextVersion: number,
    minutesId: string = randomUUID(),
  ): Promise<MeetingMinutes> {
    if (!Number.isInteger(nextVersion) || nextVersion < 1 || nextVersion > MAX_MINUTES_VERSION) {
      throw new RangeError('Meeting minutes version is out of range.');
    }
    const minutes: MeetingMinutes = {
      id: minutesId,
      meetingId: meeting.id,
      groupId: meeting.groupId,
      summary: input.summary,
      discussion: input.discussion,
      decisions: input.decisions.map(({ content }) => ({ id: randomUUID(), content })),
      actionItems: input.actionItems.map(({ content, assigneeId }) => ({
        id: randomUUID(),
        content,
        ...(assigneeId ? { assigneeId } : {}),
      })),
      version: nextVersion,
      createdBy: actorId,
      createdAt: new Date().toISOString(),
    };
    try {
      await documentClient.send(
        new PutCommand({
          TableName: tableName('MEETING_DATA_TABLE'),
          Item: {
            PK: `MEETING#${meeting.id}`,
            SK: minutesSortKey(nextVersion),
            entityType: 'MEETING_MINUTES',
            ...minutes,
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        }),
      );
      return minutes;
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      const current = await this.getLatest(meeting.id);
      if (current && current.version !== input.expectedVersion) {
        throw new ConflictError('Biên bản đã được cập nhật bởi yêu cầu khác.');
      }
      throw error;
    }
  }
}
