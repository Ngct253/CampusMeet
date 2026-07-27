import { readFile } from 'node:fs/promises';

const expectedSuffixes = [
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

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    failures.push(`${path} is not valid JSON: ${error.message}`);
    return {};
  }
}

function normalizedSchema(schema = []) {
  return schema.map(([name, type]) => `${type}:${name}`).sort();
}

function generatedSchema(schema = []) {
  return schema.map(({ AttributeName, KeyType }) => `${KeyType}:${AttributeName}`).sort();
}

const spec = await readJson('infra/data-foundation.spec.json');
const template = await readJson('.aws-sam/data-foundation.generated.json');
const importMap = await readJson('.aws-sam/data-foundation-import.json');

assert(Array.isArray(spec.tables), 'Data foundation manifest must contain tables[].');
assert(spec.tables?.length === expectedSuffixes.length, 'Data foundation manifest must define 17 tables.');
assert(spec.defaultPrefix === 'campusmeet-dev', 'Default table prefix must be campusmeet-dev.');

const actualSuffixes = (spec.tables ?? []).map(({ suffix }) => suffix).sort();
assert(
  JSON.stringify(actualSuffixes) === JSON.stringify([...expectedSuffixes].sort()),
  `Unexpected table suffix inventory: [${actualSuffixes.join(', ')}].`,
);

assert(
  Object.values(template.Resources ?? {}).filter(
    (resource) => resource.Type === 'AWS::DynamoDB::Table',
  ).length === expectedSuffixes.length,
  'Generated template must contain exactly 17 DynamoDB tables.',
);
assert(Array.isArray(importMap) && importMap.length === expectedSuffixes.length, 'Import map must contain 17 entries.');

const logicalIds = new Set();
const suffixes = new Set();

for (let index = 0; index < (spec.tables ?? []).length; index += 1) {
  const table = spec.tables[index];
  const resource = template.Resources?.[table.logicalId];
  const mapping = importMap?.[index];
  const expectedDependency = index === 0 ? undefined : spec.tables[index - 1].logicalId;

  assert(!logicalIds.has(table.logicalId), `Duplicate logical ID: ${table.logicalId}.`);
  assert(!suffixes.has(table.suffix), `Duplicate table suffix: ${table.suffix}.`);
  logicalIds.add(table.logicalId);
  suffixes.add(table.suffix);

  const usedAttributes = new Set(table.keySchema.map(([name]) => name));
  for (const gsi of table.globalSecondaryIndexes ?? []) {
    for (const [name] of gsi.keySchema) usedAttributes.add(name);
  }
  const definedAttributes = new Set(Object.keys(table.attributes));
  for (const name of usedAttributes) {
    assert(definedAttributes.has(name), `${table.logicalId} uses undefined key ${name}.`);
  }
  for (const name of definedAttributes) {
    assert(usedAttributes.has(name), `${table.logicalId} defines unused key ${name}.`);
  }

  assert(resource?.Type === 'AWS::DynamoDB::Table', `${table.logicalId} missing from generated template.`);
  assert(resource?.DeletionPolicy === 'Retain', `${table.logicalId} must retain on stack deletion.`);
  assert(resource?.UpdateReplacePolicy === 'Retain', `${table.logicalId} must retain on replacement.`);
  assert(resource?.DependsOn === expectedDependency, `${table.logicalId} dependency chain is invalid.`);
  assert(resource?.Properties?.BillingMode === 'PAY_PER_REQUEST', `${table.logicalId} must use on-demand billing.`);
  assert(resource?.Properties?.SSESpecification?.SSEEnabled === true, `${table.logicalId} must enable SSE.`);
  assert(
    resource?.Properties?.TableName?.['Fn::Sub'] === `\${TablePrefix}-${table.suffix}`,
    `${table.logicalId} generated table name is invalid.`,
  );
  assert(
    JSON.stringify(generatedSchema(resource?.Properties?.KeySchema)) ===
      JSON.stringify(normalizedSchema(table.keySchema)),
    `${table.logicalId} primary key drifted during generation.`,
  );

  const generatedGsiNames = (resource?.Properties?.GlobalSecondaryIndexes ?? [])
    .map(({ IndexName }) => IndexName)
    .sort();
  const expectedGsiNames = (table.globalSecondaryIndexes ?? []).map(({ name }) => name).sort();
  assert(
    JSON.stringify(generatedGsiNames) === JSON.stringify(expectedGsiNames),
    `${table.logicalId} GSI inventory drifted during generation.`,
  );

  assert(mapping?.LogicalResourceId === table.logicalId, `${table.logicalId} import mapping is out of order.`);
  assert(mapping?.ResourceType === 'AWS::DynamoDB::Table', `${table.logicalId} import type is invalid.`);
  assert(
    mapping?.ResourceIdentifier?.TableName === `campusmeet-dev-${table.suffix}`,
    `${table.logicalId} import table name is invalid.`,
  );
}

const applicationTemplate = await readFile('infra/template.yaml', 'utf8');
assert(
  !applicationTemplate.includes('Type: AWS::DynamoDB::Table'),
  'Application template must not create DynamoDB tables.',
);
for (const invalidAction of ['dynamodb:TransactGetItems', 'dynamodb:TransactWriteItems']) {
  assert(!applicationTemplate.includes(invalidAction), `${invalidAction} is not a valid IAM action.`);
}
for (const variable of expectedEnvironmentVariables) {
  assert(applicationTemplate.includes(`${variable}:`), `Application template is missing ${variable}.`);
}
assert(
  !/^\s*[^#\n]*[&*][A-Za-z][\w-]*/m.test(applicationTemplate),
  'Application template must not use YAML anchors or aliases.',
);

for (const path of [
  'README.md',
  'docs/architecture.md',
  'docs/huong-dan-trien-khai-aws.md',
  'docs/ke-hoach-trien-khai-nhom.md',
]) {
  const content = await readFile(path, 'utf8');
  assert(content.includes('campusmeet-dev'), `${path} must identify the dev table prefix.`);
  assert(!content.includes('Chưa có AWS resource nào được deploy'), `${path} contains stale AWS status.`);
}

if (failures.length > 0) {
  console.error('Infrastructure consistency check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Infrastructure consistency check passed: ${spec.tables.length} tables, import safety, ${expectedEnvironmentVariables.length} Lambda table variables and no duplicate table ownership.`,
);
