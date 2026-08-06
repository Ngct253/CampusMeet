import { createHash } from 'node:crypto';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  TaskStatus,
  type ConvertActionItemToTaskResponse,
  type MeetingMinutes,
  type Task,
} from '@campusmeet/shared';
import type { ActionItemTaskRepository, ActionItemTaskWrite } from '../domain/ports';
import { ConflictError } from '../utils/errors';
import { documentClient, tableName } from './client';
import { DynamoDbMinutesRepository } from './minutes';
import { DynamoDbTaskRepository } from './tasks';

const NO_DUE_DATE_SORT_VALUE = '9999-12-31T23:59:59.999Z';
const MINUTES_SK_PREFIX = 'MINUTES#VERSION#';

const taskIdFor = (meetingId: string, actionItemId: string) =>
  createHash('sha256')
    .update(JSON.stringify(['ACTION_ITEM_TASK', meetingId, actionItemId]))
    .digest('hex')
    .slice(0, 32);

const minutesSortKey = (version: number) =>
  `${MINUTES_SK_PREFIX}${String(version).padStart(6, '0')}`;

type MinutesReader = Pick<DynamoDbMinutesRepository, 'getLatest'>;
type TaskReader = Pick<DynamoDbTaskRepository, 'getById'>;

const requireValidLinkedTask = (
  task: Task | undefined,
  taskId: string,
  meetingId: string,
  actionItemId: string,
) => {
  if (
    !task ||
    task.id !== taskId ||
    task.sourceMeetingId !== meetingId ||
    task.sourceActionItemId !== actionItemId
  ) {
    throw new Error('Malformed Action Item task link.');
  }
  return task;
};

export class DynamoDbActionItemTaskRepository implements ActionItemTaskRepository {
  constructor(
    private readonly minutesReader: MinutesReader = new DynamoDbMinutesRepository(),
    private readonly taskReader: TaskReader = new DynamoDbTaskRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getTaskById(taskId: string): Promise<Task | undefined> {
    return this.taskReader.getById(taskId);
  }

  async create(input: ActionItemTaskWrite): Promise<ConvertActionItemToTaskResponse> {
    if (
      !Number.isInteger(input.minutes.version) ||
      input.minutes.version < 1 ||
      input.minutes.version >= 999999
    ) {
      throw new RangeError('Meeting minutes version is out of range for conversion.');
    }
    const actionItem = input.minutes.actionItems.find(({ id }) => id === input.actionItemId);
    if (!actionItem || actionItem.taskId) {
      throw new Error('Action Item conversion input is inconsistent.');
    }

    const taskId = taskIdFor(input.meeting.id, input.actionItemId);
    const createdAt = this.clock().toISOString();
    const task: Task = {
      id: taskId,
      groupId: input.meeting.groupId,
      title: input.title,
      assigneeId: input.assigneeId,
      status: TaskStatus.TODO,
      priority: input.priority,
      ...(actionItem.dueAt ? { dueAt: actionItem.dueAt } : {}),
      sourceMeetingId: input.meeting.id,
      sourceActionItemId: input.actionItemId,
      createdBy: input.actorId,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    };
    const nextMinutes: MeetingMinutes = {
      ...input.minutes,
      actionItems: input.minutes.actionItems.map((item) =>
        item.id === input.actionItemId ? { ...item, taskId } : item,
      ),
      version: input.minutes.version + 1,
      createdBy: input.actorId,
      createdAt,
    };
    const dueSortValue = task.dueAt ?? NO_DUE_DATE_SORT_VALUE;

    try {
      await documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName('TASK_DATA_TABLE'),
                Item: {
                  PK: `TASK#${task.id}`,
                  SK: 'META',
                  entityType: 'TASK',
                  ...task,
                  GSI1PK: `GROUP#${task.groupId}`,
                  GSI1SK: `STATUS#${task.status}#DUE#${dueSortValue}#TASK#${task.id}`,
                  GSI2PK: `USER#${task.assigneeId}`,
                  GSI2SK: `DUE#${dueSortValue}#TASK#${task.id}`,
                  GSI3PK: `MEETING#${input.meeting.id}`,
                  GSI3SK: `TASK#${createdAt}#${task.id}`,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: tableName('MEETING_DATA_TABLE'),
                Item: {
                  PK: `MEETING#${input.meeting.id}`,
                  SK: minutesSortKey(nextMinutes.version),
                  entityType: 'MEETING_MINUTES',
                  ...nextMinutes,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
          ],
        }),
      );
      return { task, minutes: nextMinutes };
    } catch (error) {
      if ((error as { name?: string }).name !== 'TransactionCanceledException') throw error;

      const latest = await this.minutesReader.getLatest(input.meeting.id);
      const latestActionItem = latest?.actionItems.find(({ id }) => id === input.actionItemId);
      if (latest && latestActionItem?.taskId) {
        const linkedTask = requireValidLinkedTask(
          await this.taskReader.getById(latestActionItem.taskId),
          latestActionItem.taskId,
          input.meeting.id,
          input.actionItemId,
        );
        return { task: linkedTask, minutes: latest };
      }
      if (latest && latest.version !== input.minutes.version) {
        throw new ConflictError('Biên bản đã được cập nhật bởi yêu cầu khác.');
      }
      throw error;
    }
  }
}
