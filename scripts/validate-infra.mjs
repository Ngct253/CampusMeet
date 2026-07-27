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

const dataTemplateText = await readFile('infra/data-foundation.yaml', 'utf8');
let dataTemplate;

try {
  dataTemplate = JSON.parse(dataTemplateText);
} catch (error) {
  failures.push(`infra/data-foundation.yaml is not valid JSON/YAML-compatible JSON: ${error.message}`);
  dataTemplate = { Resources: {} };
}

const tableResources = Object.entries(dataTemplate.Resources ?? {}).filter(
  ([, resource]) => resource.Type === 'AWS::DynamoDB::Table',
);

assert(
  tableResources.length === expectedTables.length,
  `Expected ${expectedTables.length} DynamoDB tables but found ${tableResources.length}.`,
);

const actualSuffixes = [];

for (const [logicalId, resource] of tableResources) {
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
  `Infrastructure consistency check passed: ${tableResources.length} tables, ${expectedEnvironmentVariables.length} Lambda table variables, no duplicate table ownership.`,
);
