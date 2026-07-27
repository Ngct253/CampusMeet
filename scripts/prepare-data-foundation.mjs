import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sourcePath = resolve('infra/data-foundation.yaml');
const outputPath = resolve(
  process.argv[2] ?? '.aws-sam/data-foundation.generated.json',
);

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const tableEntries = Object.entries(source.Resources ?? {}).filter(
  ([, resource]) => resource.Type === 'AWS::DynamoDB::Table',
);

if (tableEntries.length !== 17) {
  throw new Error(
    `Expected 17 DynamoDB table resources in ${sourcePath}, found ${tableEntries.length}.`,
  );
}

let previousLogicalId;

for (const [logicalId, resource] of tableEntries) {
  resource.DeletionPolicy = 'Retain';
  resource.UpdateReplacePolicy = 'Retain';

  if (previousLogicalId) {
    resource.DependsOn = previousLogicalId;
  } else {
    delete resource.DependsOn;
  }

  previousLogicalId = logicalId;
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');

console.log(
  `Prepared ${tableEntries.length} DynamoDB tables at ${outputPath} with Retain policies and sequential dependencies.`,
);
