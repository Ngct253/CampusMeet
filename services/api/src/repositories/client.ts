import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ServiceConfigurationError } from '../utils/errors';

export const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type TableEnvironmentName =
  | 'COLLABORATION_TABLE'
  | 'IDENTITY_TABLE'
  | 'MEETING_TABLE'
  | 'MEETING_DATA_TABLE'
  | 'TASK_DATA_TABLE';

export const tableName = (name: TableEnvironmentName) => {
  const value =
    name === 'MEETING_TABLE'
      ? (process.env.MEETING_DATA_TABLE ?? process.env.MEETING_TABLE)
      : name === 'MEETING_DATA_TABLE'
        ? (process.env.MEETING_DATA_TABLE ?? process.env.MEETING_TABLE)
        : process.env[name];
  if (!value) throw new ServiceConfigurationError(`Thiếu cấu hình ${name}.`);
  return value;
};

export type DynamoItem = Record<string, unknown>;

export const stringValue = (item: DynamoItem, key: string) =>
  typeof item[key] === 'string' ? item[key] : undefined;
