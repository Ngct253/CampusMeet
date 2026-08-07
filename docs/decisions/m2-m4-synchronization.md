# M2-M4 Synchronization

## Status

ACCEPTED — PRINCIPLE

## Accepted behavior

The internal CampusMeet Meeting is the source of truth for its internal lifecycle. A successful internal create, update, or cancel is not rolled back because Google Calendar/Meet synchronization fails. Google synchronization is eventually consistent; failures must be recorded and M4 retries idempotently without creating duplicate Google events.

## Current repository maturity

The current main-integrated M2 application service does not call Google. `GoogleCalendarAdapter` is a placeholder that throws `NotImplementedError`; there is no approved outbox/job persistence, Google-event reference storage, retry scheduler, retry count, or backoff policy connected to Meeting mutations. Therefore the current internal Meeting path cannot be rolled back by Google, but runtime synchronization and retry are not implemented or verified.

## Responsibilities and failure semantics

- M2 commits the internal Meeting lifecycle independently of external-provider availability.
- M4 owns Google credentials, event mapping, failure recording, and idempotent retry.
- An external failure must remain observable once the status/storage contract is approved.
- Retry must reuse a stable operation identity and reconcile an existing Google event instead of blindly creating another event.
- Tokens and secrets must never be returned to the browser or written to logs.

## Unresolved implementation details

Exact sync status enum, retry count/backoff, EventBridge versus SQS versus manual retry, storage of Google event ID and Meet URL, UX, and storage schema remain unresolved. No queue, table, scheduler, or retry policy may be invented until those details have an approved source of truth.

## Implementation prerequisites

1. Approve the integration record/job schema and ownership.
2. Approve idempotency and Google event reconciliation rules for create/update/cancel.
3. Approve retry transport, count, backoff, recovery, and observability.
4. Update IaC through the repository and validate it; do not create resources manually.

## Follow-up acceptance criteria

- Create, update, and cancel remain persisted when the corresponding Google call fails.
- Failure state/request is persisted and observable.
- Retrying the same operation does not create a duplicate Google event.
- A stable idempotency key produces one external effect.
- Pending/failed UX is accurate once approved.
- Logs contain no OAuth token, Google secret, or credential.
- AWS runtime behavior is claimed only after deployment and smoke verification.
