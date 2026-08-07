# M3 Group Progress Snapshot Contract

## Status

PROPOSED — PENDING TEAM/MAINTAINER APPROVAL; RUNTIME PRODUCER NOT IMPLEMENTED

## Proposed date

2026-08-08

## Scope

This decision defines the shared domain schema, aggregation semantics, persistence keys, lifecycle, and M3/M5 ownership boundary for `GroupProgressSnapshot`. It does not implement a producer, repository, service, mutation hook, public endpoint, infrastructure change, or frontend.

## Domain contract

```ts
interface GroupProgressSnapshot {
  groupId: string;
  version: number; // integer 1..9_999_999_999
  generatedAt: ISODateTime;
  taskCounts: {
    total: number;
    todo: number;
    doing: number;
    done: number;
    overdue: number;
  };
  meetingCounts: {
    completed: number;
    upcoming: number;
  };
}
```

The public schema is strict and contains no DynamoDB metadata. Every count is a non-negative integer. `total = todo + doing + done`, and `overdue <= todo + doing`.

`generatedAt` is the server-generated UTC aggregation cutoff. A producer uses that one cutoff for every source query and count in a generation attempt.

### Aggregation semantics

- Task counts include valid Task `META` records for the group and classify status only as `TODO`, `DOING`, or `DONE`.
- A task is overdue only when `dueAt` exists, `dueAt < generatedAt`, and status is not `DONE`. A task without `dueAt`, or with `dueAt === generatedAt`, is not overdue.
- `meetingCounts.completed` includes Meetings with status `COMPLETED`.
- `meetingCounts.upcoming` includes Meetings with status `SCHEDULED` and `startsAt >= generatedAt`.
- Meetings with status `DRAFT` or `CANCELLED` do not contribute to either Meeting count.
- Minutes content and Minutes existence do not affect this snapshot.
- The snapshot contains no ranking, score, name, member identifier, or individual performance metric.

Source reads use the existing Task group index and Meeting group timeline index. Those GSI reads are eventually consistent, so a snapshot is a bounded aggregate at `generatedAt`, not a transactionally exact view across source tables.

## Persistence contract

Snapshots are stored in `task-data` under the group partition.

### Immutable version record

```text
PK=GROUP#<groupId>
SK=PROGRESS_SNAPSHOT#VERSION#<10-digit-version>
entityType=GROUP_PROGRESS_SNAPSHOT
recordType=VERSION
generationId=<opaque generation identifier>
...full GroupProgressSnapshot domain fields
```

### Latest record

```text
PK=GROUP#<groupId>
SK=PROGRESS_SNAPSHOT#LATEST
entityType=GROUP_PROGRESS_SNAPSHOT
recordType=LATEST
generationId=<same generation identifier as the version record>
...full GroupProgressSnapshot domain fields
```

Version sort keys use exactly ten decimal digits, from `0000000001` through `9999999999`. Version records are immutable. `LATEST` is a full copy of the most recently successfully generated version, not a pointer and not a continuously live aggregate. Persistence metadata must be validated and removed before the strict public schema is parsed or returned.

A future writer must atomically put the immutable version and replace `LATEST` in one DynamoDB transaction. No GSI or new table is required by this contract.

## Lifecycle and concurrency

The minimal runtime model is on-demand generation initiated by progress-analysis orchestration. It avoids synchronous work on Task or Meeting mutations and avoids introducing a scheduler or event fan-out before those behaviors are required.

For each generation attempt, the future M3 writer must:

1. strongly read `PROGRESS_SNAPSHOT#LATEST` to determine the current version;
2. allocate `N + 1`, or `1` when no snapshot exists;
3. choose one server UTC `generatedAt` cutoff and recompute the full aggregate;
4. transactionally put the immutable version and conditionally publish the matching full `LATEST` record;
5. return the successfully persisted immutable version.

The transaction condition must ensure the observed latest version has not changed. A losing concurrent writer must not publish its stale aggregate under a later version; it re-reads and recomputes with a new cutoff before retrying. If generation or persistence fails, no partial version/latest pair is visible and no AI job may treat that failed generation as resolved.

M5 consumes an exact immutable version. It must not silently fall back from a requested version to `LATEST`. `LATEST` is useful only when resolving a request before an exact version is fixed.

## Progress-analysis request behavior

- When `snapshotVersion` is present, the application resolves that exact immutable version before enqueueing the AI job.
- When `snapshotVersion` is omitted, M3 generates and persists a fresh snapshot before the AI job is enqueued, then the job payload must carry the resolved version.
- The worker reads only that resolved immutable version. It does not read `LATEST` as a fallback.
- Missing or malformed snapshot data must fail safely and must not be sent to the model.

The current public error vocabulary does not define a stable error code for a missing or corrupt requested snapshot. That code remains a follow-up decision; implementations must use the common error envelope and must not invent a public code in this contract-only change.

## Idempotency contract gap

The current AI request idempotency key is scoped by actor, group, operation, and key and recovers the previously created `AIJob`. It neither hashes the request payload nor persists a resolved snapshot version in the idempotency result. Therefore it is not yet sufficient to guarantee that retrying an accepted request resolves the same snapshot version when fresh generation occurs before enqueue.

The implementation PR must close this gap at the existing AI request idempotency boundary before enabling omitted-version generation. This decision intentionally does not add a new idempotency item shape.

## Ownership boundary

- M3 owns deterministic aggregation, source validation, snapshot schema enforcement, version allocation, and atomic persistence in `task-data`.
- M5 owns progress-analysis job orchestration, interpretation of one exact immutable snapshot version, model output validation, and AI result delivery.
- M5 does not recompute, mutate, repair, or fall back between snapshot versions.

## Deferred decisions and blockers

- retention or cleanup policy for immutable snapshot versions;
- the exact change to AI request idempotency needed to bind retries to one resolved version;
- stable public error codes for missing or corrupt snapshots;
- maximum supported group size and generation latency budget;
- the runtime path that moves Meetings to `COMPLETED`, if that lifecycle mutation is still absent.

These gaps do not weaken the schema or persistence contract, but they must be resolved before production runtime implementation where applicable.
