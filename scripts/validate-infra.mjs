import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dataTemplatePath = new URL('../infra/data-foundation.yaml', import.meta.url);
const appTemplatePath = new URL('../infra/template.yaml', import.meta.url);
const dataModelPath = new URL('../docs/dynamodb-data-model.md', import.meta.url);

const dataTemplate = JSON.parse(await readFile(dataTemplatePath, 'utf8'));
const appTemplate = await readFile(appTemplatePath, 'utf8');
const dataModel = await readFile(dataModelPath, 'utf8');

const expected = new Map([
  ['IdentityTable', { suffix: 'identity', gsis: 2 }],
  ['CollaborationTable', { suffix: 'collaboration', gsis: 2 }],
  ['MeetingDataTable', { suffix: 'meeting-data', gsis: 3 }],
  ['TaskDataTable', { suffix: 'task-data', gsis: 3 }],
  ['AIWorkTable', { suffix: 'ai-work', gsis: 2 }],
]);

assert.equal(
  dataTemplate.Description.includes('Five domain tables'),
  true,
  'Data foundation description must identify the five-table model.',
);

const resources = dataTemplate.Resources ?? {};
assert.deepEqual(
  Object.keys(resources).sort(),
  [...expected.keys()].sort(),
  'Data foundation must contain exactly the five approved DynamoDB resources.',
);

for (const [logicalId, contract] of expected) {
  const resource = resources[logicalId];
  assert.equal(resource.Type, 'AWS::DynamoDB::Table', `${logicalId} must be DynamoDB.`);
  assert.equal(resource.DeletionPolicy, 'Retain', `${logicalId} must retain data on stack deletion.`);
  assert.equal(
    resource.UpdateReplacePolicy,
    'Retain',
    `${logicalId} must retain data on replacement.`,
  );

  const properties = resource.Properties;
  assert.equal(
    properties.TableName?.['Fn::Sub'],
    `\${TablePrefix}-${contract.suffix}`,
    `${logicalId} physical name is incorrect.`,
  );
  assert.equal(properties.BillingMode, 'PAY_PER_REQUEST');
  assert.equal(properties.SSESpecification?.SSEEnabled, true);
  assert.deepEqual(properties.KeySchema, [
    { AttributeName: 'PK', KeyType: 'HASH' },
    { AttributeName: 'SK', KeyType: 'RANGE' },
  ]);
  assert.equal(
    properties.GlobalSecondaryIndexes?.length,
    contract.gsis,
    `${logicalId} GSI count is incorrect.`,
  );
  assert.deepEqual(properties.TimeToLiveSpecification, {
    AttributeName: 'expiresAtEpoch',
    Enabled: true,
  });

  const modelVersion = properties.Tags.find((tag) => tag.Key === 'DataModelVersion');
  assert.equal(modelVersion?.Value, '2');
  assert.equal(dataModel.includes(`campusmeet-dev-${contract.suffix}`), true);
}

assert.equal(
  appTemplate.includes('Type: AWS::DynamoDB::Table'),
  false,
  'Application stack must not create DynamoDB tables; deploy data-foundation.yaml first.',
);

for (const variable of [
  'IDENTITY_TABLE',
  'COLLABORATION_TABLE',
  'MEETING_DATA_TABLE',
  'TASK_DATA_TABLE',
  'AI_WORK_TABLE',
]) {
  assert.equal(appTemplate.includes(variable), true, `Application template is missing ${variable}.`);
}

for (const invalidAction of ['dynamodb:TransactGetItems', 'dynamodb:TransactWriteItems']) {
  assert.equal(
    appTemplate.includes(invalidAction),
    false,
    `Invalid IAM action must not appear: ${invalidAction}`,
  );
}

console.log('Infrastructure contract validation passed: five-table DynamoDB model.');
