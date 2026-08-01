import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ServiceConfigurationError } from '../utils/errors';

export const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const tableName = (name: 'COLLABORATION_TABLE' | 'IDENTITY_TABLE') => {
  const value = process.env[name];
  if (!value) throw new ServiceConfigurationError(`Thiếu cấu hình ${name}.`);
  return value;
};

export type DynamoItem = Record<string, unknown>;

export const stringValue = (item: DynamoItem, key: string) =>
  typeof item[key] === 'string' ? item[key] : undefined;
