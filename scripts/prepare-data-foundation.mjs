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

const sourcePath = resolve('infra/data-foundation.yaml');
const outputPath = resolve(
  args.get('--output') ?? '.aws-sam/data-foundation.generated.json',
);
const importMapPath = resolve(
  args.get('--import-map') ?? '.aws-sam/data-foundation-import.json',
);

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const tablePrefix = args.get('--prefix') ?? source.Parameters?.TablePrefix?.Default;

if (!tablePrefix || !/^[a-z0-9-]+$/.test(tablePrefix)) {
  throw new Error(`Invalid table prefix: ${tablePrefix ?? '<missing>'}.`);
}

const tableEntries = Object.entries(source.Resources ?? {}).filter(
  ([, resource]) => resource.Type === 'AWS::DynamoDB::Table',
);

if (tableEntries.length !== 17) {
  throw new Error(
    `Expected 17 DynamoDB table resources in ${sourcePath}, found ${tableEntries.length}.`,
  );
}

let previousLogicalId;
const resourcesToImport = [];

for (const [logicalId, resource] of tableEntries) {
  resource.DeletionPolicy = 'Retain';
  resource.UpdateReplacePolicy = 'Retain';

  if (previousLogicalId) {
    resource.DependsOn = previousLogicalId;
  } else {
    delete resource.DependsOn;
  }

  const tableNameExpression = resource.Properties?.TableName?.['Fn::Sub'];
  const expectedPrefix = '${TablePrefix}-';
  if (typeof tableNameExpression !== 'string' || !tableNameExpression.startsWith(expectedPrefix)) {
    throw new Error(`${logicalId} must use a TableName beginning with ${expectedPrefix}.`);
  }

  const suffix = tableNameExpression.slice(expectedPrefix.length);
  resourcesToImport.push({
    ResourceType: 'AWS::DynamoDB::Table',
    LogicalResourceId: logicalId,
    ResourceIdentifier: { TableName: `${tablePrefix}-${suffix}` },
  });

  previousLogicalId = logicalId;
}

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(importMapPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
await writeFile(importMapPath, `${JSON.stringify(resourcesToImport, null, 2)}\n`, 'utf8');

console.log(
  `Prepared ${tableEntries.length} DynamoDB tables at ${outputPath} with Retain policies and sequential dependencies.`,
);
console.log(`Prepared resource import map for prefix ${tablePrefix} at ${importMapPath}.`);
