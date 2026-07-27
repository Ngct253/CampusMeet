import { readFile } from 'node:fs/promises';

const expectedTables = [
  'users',
  'groups',
  'memberships',
  'invitations',
  'meetings',
  'reminders',
  'minutes',
  'tasks',
  'notifications',
  'audit-logs',
  'attachments',
  'recordings',
  'recording-consents',
  'transcripts',
  'ai-jobs',
  'ai-conversations',
  'tool-proposals',
];

const expectedEnvironmentVariables = [
  'USERS_TABLE',
  'GROUPS_TABLE',
  'MEMBERSHIPS_TABLE',
  'INVITATIONS_TABLE',
  'MEETINGS_TABLE',
  'REMINDERS_TABLE',
  'MINUTES_TABLE',
  'TASKS_TABLE',
  'NOTIFICATIONS_TABLE',
  'AUDIT_LOGS_TABLE',
  'ATTACHMENTS_TABLE',
  'RECORDINGS_TABLE',
  'RECORDING_CONSENTS_TABLE',
  'TRANSCRIPTS_TABLE',
  'AI_JOBS_TABLE',
  'AI_CONVERSATIONS_TABLE',
  'TOOL_PROPOSALS_TABLE',
];

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function keyAttributes(schema = []) {
  return schema.map(({ AttributeName }) => AttributeName);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    failures.push(`${path} is not valid JSON/YAML-compatible JSON: ${error.message}`);
    return { Resources: {} };
  }
}

const sourceTemplate = await readJson('infra/data-foundation.yaml');
const generatedTemplate = await readJson('.aws-sam/data-foundation.generated.json');
const importMap = await readJson('.aws-sam/data-foundation-import.json');

const sourceTables = Object.entries(sourceTemplate.Resources ?? {}).filter(
  ([, resource]) => resource.Type === 'AWS::DynamoDB::Table',
);
const generatedTables = Object.entries(generatedTemplate.Resources ?? {}).filter(
  ([, resource]) => resource.Type === 'AWS::DynamoDB::Table',
);

assert(
  sourceTables.length === expectedTables.length,
  `Expected ${expectedTables.length} source DynamoDB tables but found ${sourceTables.length}.`,
);
assert(
  generatedTables.length === expectedTables.length,
  `Expected ${expectedTables.length} generated DynamoDB tables but found ${generatedTables.length}.`,
);
assert(
  Array.isArray(importMap) && importMap.length === expectedTables.length,
  `Expected ${expectedTables.length} resource import entries.`,
);

const actualSuffixes = [];

for (const [logicalId, resource] of sourceTables) {
  const properties = resource.Properties ?? {};
  const tableName = properties.TableName?.['Fn::Sub'];
  const prefix = '${TablePrefix}-';

  assert(typeof tableName === 'string', `${logicalId} must define TableName with Fn::Sub.`);
  assert(properties.BillingMode === 'PAY_PER_REQUEST', `${logicalId} must use PAY_PER_REQUEST.`);
  assert(properties.SSESpecification?.SSEEnabled === true, `${logicalId} must enable SSE.`);

  if (typeof tableName === 'string' && tableName.startsWith(prefix)) {
    actualSuffixes.push(tableName.slice(prefix.length));
  } else {
    failures.push(`${logicalId} table name must start with ${prefix}.`);
  }

  const definitions = new Set(
    (properties.AttributeDefinitions ?? []).map(({ AttributeName }) => AttributeName),
  );
  const usedAttributes = new Set(keyAttributes(properties.KeySchema));

  for (const index of properties.GlobalSecondaryIndexes ?? []) {
    assert(Boolean(index.IndexName), `${logicalId} has a GSI without IndexName.`);
    for (const attribute of keyAttributes(index.KeySchema)) usedAttributes.add(attribute);
  }

  for (const attribute of usedAttributes) {
    assert(definitions.has(attribute), `${logicalId} uses key ${attribute} without AttributeDefinitions.`);
  }

  for (const attribute of definitions) {
    assert(usedAttributes.has(attribute), `${logicalId} defines unused key attribute ${attribute}.`);
  }
}

assert(
  JSON.stringify([...actualSuffixes].sort()) === JSON.stringify([...expectedTables].sort()),
  `DynamoDB suffix inventory differs. Expected [${expectedTables.join(', ')}], found [${actualSuffixes.join(', ')}].`,
);

for (let index = 0; index < generatedTables.length; index += 1) {
  const [logicalId, resource] = generatedTables[index];
  const expectedDependency = index === 0 ? undefined : generatedTables[index - 1][0];
  const mapping = Array.isArray(importMap) ? importMap[index] : undefined;

  assert(resource.DeletionPolicy === 'Retain', `${logicalId} must use DeletionPolicy Retain.`);
  assert(
    resource.UpdateReplacePolicy === 'Retain',
    `${logicalId} must use UpdateReplacePolicy Retain.`,
  );
  assert(
    resource.DependsOn === expectedDependency,
    `${logicalId} must depend on ${expectedDependency ?? 'no previous table'}.`,
  );
  assert(
    mapping?.LogicalResourceId === logicalId,
    `Import map entry ${index + 1} must target ${logicalId}.`,
  );
  assert(
    mapping?.ResourceType === 'AWS::DynamoDB::Table',
    `${logicalId} import entry must use AWS::DynamoDB::Table.`,
  );
  assert(
    mapping?.ResourceIdentifier?.TableName?.startsWith('campusmeet-dev-'),
    `${logicalId} import entry must target the dev prefix.`,
  );
}

const applicationTemplate = await readFile('infra/template.yaml', 'utf8');

assert(
  !applicationTemplate.includes('Type: AWS::DynamoDB::Table'),
  'infra/template.yaml must consume the shared data foundation and must not create DynamoDB tables.',
);

for (const invalidAction of ['dynamodb:TransactGetItems', 'dynamodb:TransactWriteItems']) {
  assert(!applicationTemplate.includes(invalidAction), `${invalidAction} is not a valid IAM action.`);
}

for (const variable of expectedEnvironmentVariables) {
  assert(applicationTemplate.includes(`${variable}:`), `infra/template.yaml is missing ${variable}.`);
}

assert(
  !/^\s*[^#\n]*[&*][A-Za-z][\w-]*/m.test(applicationTemplate),
  'infra/template.yaml must not use YAML anchors or aliases because CloudFormation does not support them.',
);

const synchronizedDocs = [
  'README.md',
  'docs/architecture.md',
  'docs/huong-dan-trien-khai-aws.md',
  'docs/ke-hoach-trien-khai-nhom.md',
];

for (const path of synchronizedDocs) {
  const content = await readFile(path, 'utf8');
  assert(content.includes('campusmeet-dev'), `${path} must identify the dev table prefix.`);
  assert(!content.includes('Chưa có AWS resource nào được deploy'), `${path} still contains stale AWS status.`);
}

if (failures.length > 0) {
  console.error('Infrastructure consistency check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Infrastructure consistency check passed: ${sourceTables.length} tables, ${expectedEnvironmentVariables.length} Lambda table variables, retained sequential synthesis and import mapping, no duplicate table ownership.`,
);
