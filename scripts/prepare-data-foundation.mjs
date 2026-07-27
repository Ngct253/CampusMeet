import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith('--') || value === undefined) {
    throw new Error(
      'Usage: node scripts/prepare-data-foundation.mjs [--output <path>] [--import-map <path>] [--prefix <table-prefix>]',
    );
  }
  args.set(key, value);
}

const specPath = resolve('infra/data-foundation.spec.json');
const outputPath = resolve(
  args.get('--output') ?? '.aws-sam/data-foundation.generated.json',
);
const importMapPath = resolve(
  args.get('--import-map') ?? '.aws-sam/data-foundation-import.json',
);

const spec = JSON.parse(await readFile(specPath, 'utf8'));
const tablePrefix = args.get('--prefix') ?? spec.defaultPrefix;

if (!tablePrefix || !/^[a-z0-9-]+$/.test(tablePrefix)) {
  throw new Error(`Invalid table prefix: ${tablePrefix ?? '<missing>'}.`);
}

if (!Array.isArray(spec.tables) || spec.tables.length !== 17) {
  throw new Error(`Expected 17 table definitions in ${specPath}.`);
}

const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'CampusMeet DynamoDB data foundation generated from infra/data-foundation.spec.json.',
  Parameters: {
    Environment: {
      Type: 'String',
      Default: spec.defaultEnvironment ?? 'dev',
      AllowedValues: ['dev', 'staging', 'prod'],
    },
    TablePrefix: {
      Type: 'String',
      Default: spec.defaultPrefix,
      AllowedPattern: '^[a-z0-9-]+$',
    },
    EnablePointInTimeRecovery: {
      Type: 'String',
      Default: 'false',
      AllowedValues: ['true', 'false'],
    },
    EnableDeletionProtection: {
      Type: 'String',
      Default: 'false',
      AllowedValues: ['true', 'false'],
    },
  },
  Conditions: {
    EnablePitr: {
      'Fn::Equals': [{ Ref: 'EnablePointInTimeRecovery' }, 'true'],
    },
    DeletionProtectionEnabledCondition: {
      'Fn::Equals': [{ Ref: 'EnableDeletionProtection' }, 'true'],
    },
  },
  Resources: {},
  Outputs: {
    TablePrefix: {
      Description: 'Prefix used by every CampusMeet DynamoDB table.',
      Value: { Ref: 'TablePrefix' },
    },
  },
};

const resourcesToImport = [];
const logicalIds = new Set();
const suffixes = new Set();
let previousLogicalId;

for (const table of spec.tables) {
  const { logicalId, suffix, attributes, keySchema, globalSecondaryIndexes = [], ttlAttribute } = table;

  if (!/^[A-Za-z][A-Za-z0-9]+$/.test(logicalId)) {
    throw new Error(`Invalid logicalId: ${logicalId}.`);
  }
  if (!/^[a-z0-9-]+$/.test(suffix)) {
    throw new Error(`Invalid table suffix for ${logicalId}: ${suffix}.`);
  }
  if (logicalIds.has(logicalId) || suffixes.has(suffix)) {
    throw new Error(`Duplicate table logicalId or suffix: ${logicalId}/${suffix}.`);
  }
  logicalIds.add(logicalId);
  suffixes.add(suffix);

  const usedAttributes = new Set(keySchema.map(([name]) => name));
  for (const index of globalSecondaryIndexes) {
    for (const [name] of index.keySchema) usedAttributes.add(name);
  }

  const definedAttributes = new Set(Object.keys(attributes));
  for (const name of usedAttributes) {
    if (!definedAttributes.has(name)) {
      throw new Error(`${logicalId} uses undefined key attribute ${name}.`);
    }
  }
  for (const name of definedAttributes) {
    if (!usedAttributes.has(name)) {
      throw new Error(`${logicalId} defines unused key attribute ${name}.`);
    }
  }

  const properties = {
    TableName: { 'Fn::Sub': `\${TablePrefix}-${suffix}` },
    BillingMode: 'PAY_PER_REQUEST',
    SSESpecification: { SSEEnabled: true },
    PointInTimeRecoverySpecification: {
      PointInTimeRecoveryEnabled: {
        'Fn::If': ['EnablePitr', true, false],
      },
    },
    DeletionProtectionEnabled: {
      'Fn::If': ['DeletionProtectionEnabledCondition', true, false],
    },
    AttributeDefinitions: Object.entries(attributes).map(([AttributeName, AttributeType]) => ({
      AttributeName,
      AttributeType,
    })),
    KeySchema: keySchema.map(([AttributeName, KeyType]) => ({ AttributeName, KeyType })),
    Tags: [
      { Key: 'Project', Value: 'CampusMeet' },
      { Key: 'Environment', Value: { Ref: 'Environment' } },
      { Key: 'ManagedBy', Value: 'CloudFormation' },
    ],
  };

  if (globalSecondaryIndexes.length > 0) {
    properties.GlobalSecondaryIndexes = globalSecondaryIndexes.map((index) => ({
      IndexName: index.name,
      KeySchema: index.keySchema.map(([AttributeName, KeyType]) => ({ AttributeName, KeyType })),
      Projection: { ProjectionType: 'ALL' },
    }));
  }

  if (ttlAttribute) {
    properties.TimeToLiveSpecification = {
      AttributeName: ttlAttribute,
      Enabled: true,
    };
  }

  template.Resources[logicalId] = {
    Type: 'AWS::DynamoDB::Table',
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    ...(previousLogicalId ? { DependsOn: previousLogicalId } : {}),
    Properties: properties,
  };

  template.Outputs[`${logicalId}Name`] = { Value: { Ref: logicalId } };
  resourcesToImport.push({
    ResourceType: 'AWS::DynamoDB::Table',
    LogicalResourceId: logicalId,
    ResourceIdentifier: { TableName: `${tablePrefix}-${suffix}` },
  });

  previousLogicalId = logicalId;
}

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(importMapPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
await writeFile(importMapPath, `${JSON.stringify(resourcesToImport, null, 2)}\n`, 'utf8');

console.log(
  `Prepared ${spec.tables.length} DynamoDB tables at ${outputPath} with Retain policies and sequential dependencies.`,
);
console.log(`Prepared resource import map for prefix ${tablePrefix} at ${importMapPath}.`);
