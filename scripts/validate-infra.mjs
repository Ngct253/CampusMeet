import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dataTemplatePath = new URL('../infra/data-foundation.yaml', import.meta.url);
const appTemplatePath = new URL('../infra/template.yaml', import.meta.url);
const m4TemplatePath = new URL('../infra/user-content-orchestration.yaml', import.meta.url);
const dataModelPath = new URL('../docs/dynamodb-data-model.md', import.meta.url);

const dataTemplate = JSON.parse(await readFile(dataTemplatePath, 'utf8'));
const appTemplate = await readFile(appTemplatePath, 'utf8');
const m4Template = await readFile(m4TemplatePath, 'utf8');
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
  assert.equal(
    resource.DeletionPolicy,
    'Retain',
    `${logicalId} must retain data on stack deletion.`,
  );
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
  assert.equal(
    appTemplate.includes(variable),
    true,
    `Application template is missing ${variable}.`,
  );
}

for (const invalidAction of ['dynamodb:TransactGetItems']) {
  assert.equal(
    appTemplate.includes(invalidAction),
    false,
    `Invalid IAM action must not appear: ${invalidAction}`,
  );
}

for (const parameter of [
  'UserContentBucketName',
  'BedrockEmbeddingModelId',
  'BedrockEmbeddingDimensions',
  'BedrockGenerationModelArn',
]) {
  assert.equal(
    appTemplate.includes(`  ${parameter}:`),
    true,
    `Application template is missing required AI parameter ${parameter}.`,
  );
}

for (const marker of [
  'AIWorkerRole:',
  'AIWorkerFunction:',
  'Handler: services/ai-worker/src/index.handler',
  'EntryPoints: [services/ai-worker/src/index.ts]',
  'USER_CONTENT_BUCKET: !Ref UserContentBucketName',
  'BEDROCK_KNOWLEDGE_BASE_ID: !Ref CampusMeetKnowledgeBase',
  'BEDROCK_DATA_SOURCE_ID: !GetAtt CampusMeetKnowledgeDataSource.DataSourceId',
  'BEDROCK_GENERATION_MODEL_ID: !Ref BedrockGenerationModelArn',
  'RequireResolvedAIInfrastructure:',
  'KnowledgeVectorBucket:',
  'Type: AWS::S3Vectors::VectorBucket',
  'KnowledgeVectorIndex:',
  'Type: AWS::S3Vectors::Index',
  'Dimension: !Ref BedrockEmbeddingDimensions',
  'DistanceMetric: cosine',
  'KnowledgeBaseRole:',
  'Principal: { Service: bedrock.amazonaws.com }',
  'CampusMeetKnowledgeBase:',
  'Type: AWS::Bedrock::KnowledgeBase',
  'EmbeddingDataType: FLOAT32',
  'Type: S3_VECTORS',
  'CampusMeetKnowledgeDataSource:',
  'Type: AWS::Bedrock::DataSource',
  'DataDeletionPolicy: DELETE',
  'InclusionPrefixes: [kb/]',
  'MaxTokens: 300',
  'OverlapPercentage: 20',
  's3vectors:PutVectors',
  's3vectors:GetVectors',
  's3vectors:DeleteVectors',
  's3vectors:QueryVectors',
  's3vectors:GetIndex',
  's3:DeleteObject',
  'bedrock:Retrieve',
  'bedrock:StartIngestionJob',
  'bedrock:GetIngestionJob',
  'bedrock:InvokeModel',
  'AIWorkerLogGroup:',
  'AIWorkerErrorAlarm:',
  'AIWorkerDurationAlarm:',
  'AIWorkerFunctionArn:',
  'KnowledgeBaseId:',
  'KnowledgeDataSourceId:',
  'KnowledgeVectorBucketArn:',
  'KnowledgeVectorIndexArn:',
]) {
  assert.equal(appTemplate.includes(marker), true, `Application template is missing ${marker}.`);
}

for (const removedExternalParameter of ['BedrockKnowledgeBaseId:', 'BedrockDataSourceId:']) {
  assert.equal(
    appTemplate.includes(`  ${removedExternalParameter}`),
    false,
    `${removedExternalParameter} must be created by M5-6B instead of supplied externally.`,
  );
}

assert.equal(
  appTemplate.includes('UserContentBucket:\n'),
  false,
  'M5 must consume the M4-owned user-content bucket instead of creating one.',
);
assert.equal(
  appTemplate.includes('Type: AWS::Serverless::StateMachine'),
  false,
  'M5 must not create the M4-owned Step Functions state machine.',
);
assert.equal(
  appTemplate.includes('Type: AWS::StepFunctions::StateMachine'),
  false,
  'M5 must not create the M4-owned Step Functions state machine.',
);

for (const marker of [
  'UserContentBucket:',
  'Type: AWS::StepFunctions::StateMachine',
  'ReminderFunction:',
  'Handler: services/api/src/index.reminderHandler',
  'SchedulerExecutionRole:',
  'SesConfigurationSet:',
  'UserContentBucketName:',
  'AIStateMachineArn:',
  'ReminderFunctionArn:',
  'SchedulerExecutionRoleArn:',
  'SesConfigurationSetName:',
  'ExistingUserContentBucketName:',
  'CreateUserContentBucket:',
]) {
  assert.equal(m4Template.includes(marker), true, `M4 template is missing ${marker}.`);
}

assert.equal(
  m4Template.includes('"Arguments":'),
  false,
  'The JSONPath Step Functions definition must use Parameters instead of JSONata Arguments.',
);
assert.equal(
  m4Template.includes('"Parameters":'),
  true,
  'The Lambda optimized integration must define JSONPath Parameters.',
);

for (const marker of [
  '  ReminderFunction:',
  '  SchedulerExecutionRole:',
  '  SesConfigurationSet:',
]) {
  assert.equal(
    appTemplate.includes(marker),
    false,
    `Application template must consume, not create, the M4 resource ${marker.trim()}.`,
  );
}

assert.equal(
  appTemplate.includes('USER_POOL_ID: !Ref UserPool'),
  true,
  'API must receive the Cognito User Pool id.',
);
assert.equal(
  appTemplate.includes('cognito-idp:AdminGetUser'),
  true,
  'API role must be able to read verified Cognito attributes.',
);

console.log(
  'Infrastructure contract validation passed: data foundation, M5 AI Worker, Knowledge Base, and S3 Vectors.',
);
