# M2 Meeting Contract Decisions

## Status

ACCEPTED

## Accepted date

2026-08-06

## Context

M2 source is close to complete: agenda, optimistic-conflict UX, lifecycle, validation, and tests exist. The team accepted the previously open organizer, Meeting PATCH version, Meeting-list pagination, and M2-M4 synchronization choices. This record captures those decisions; implementation remains out of scope for this documentation change.

Audit precedence remains SRS, API contract, DynamoDB model, team plan/architecture, implementation, then tests. Implementation follow-ups must align those sources with this accepted record.

## Scope

This record includes Organizer, PATCH version, Meeting pagination, and the original M2-M4 Google synchronization decision. The complete runtime follow-up is now accepted separately. This record excludes implementation, AWS deployment, transcription/recording/AI, and DynamoDB migration.

## Accepted decisions

The team accepted:

- Organizer: Option 1A.
- PATCH version: Option 2B.
- Pagination: Option 3A.
- M2-M4 synchronization: Option 4A.

### Organizer - Option 1A

- In the MVP, the authenticated creator is always the Meeting organizer.
- `organizerId` comes from trusted authentication context.
- Clients cannot send `organizerId` when creating a Meeting.
- Clients cannot change `organizerId` when updating a Meeting.
- The MVP frontend has no organizer selector.
- Organizer reassignment after Meeting creation is unsupported.
- Creator and organizer are the same actor in the MVP.

Consequences: a Group Admin cannot select another organizer; reassignment is outside MVP scope; M4 uses the creator-equals-organizer assumption in the MVP.

### PATCH version - Option 2B

- `version` is required for every Meeting PATCH.
- A PATCH request missing `version` is rejected by validation.
- Service must not fall back to the persisted latest version when the client omits it.
- Repository conditional write uses the expected version supplied by the client.
- A stale version returns HTTP `409` through the current error envelope.
- All first-party callers are updated in the same implementation milestone.
- This is a breaking API contract change.

### Pagination - Option 3A

- The existing Meeting-list endpoint changes to a paginated page response.
- No parallel legacy endpoint is created unless implementation audit finds a mandatory obstacle and the team accepts a new change.
- All first-party consumers migrate together.
- The new backend response must not merge while M2, M3, M5, or Dashboard still expects an array.
- This is a coordinated breaking change.

Target contract:

```http
GET /groups/{groupId}/meetings?limit=<n>&cursor=<opaque>
```

The response follows the current success-envelope convention:

```json
{
  "success": true,
  "data": {
    "items": [],
    "nextCursor": "opaque-cursor"
  },
  "requestId": "request-id"
}
```

Accepted rules:

- Minimum limit: 1; default limit: 20; maximum limit: 100.
- Cursor is opaque; clients do not decode it.
- Public cursor does not expose DynamoDB PK, SK, or `LastEvaluatedKey`.
- Malformed cursor returns a validation error.
- Ordering is stable.
- Changing group resets pages and cursor.
- A later-page error does not remove already loaded data.
- At the end, `nextCursor` is omitted: `nextCursor?: string`.

Consumer requirements:

- M2 Meeting timeline uses load more or equivalent pagination.
- M3 Task selector loads all Meetings it needs, not only the first page.
- M5 multi-meeting/RAG consumers must not silently use only the first page.
- Dashboard must not use `items.length` from one page as the total Meeting count.
- Single-ID `MeetingAccessBoundary` is unaffected.

## Related accepted decision: M2-M4 Google synchronization

Option 4A is accepted. Its complete runtime design was accepted on 2026-08-07 in [M2–M4 synchronization](m2-m4-synchronization.md):

- Internal Meeting is the source of truth for its internal lifecycle.
- Internal create, update, or cancel is not rolled back only because Google Calendar/Meet synchronization fails.
- Google synchronization uses eventual consistency.
- Synchronization failure is recorded as an error state.
- M4 retries idempotently.
- Users can recognize an appropriate pending/failed state under UX defined in the follow-up.
- Retry must not create duplicate Google events.

The follow-up locks the status enum, separate sync record in `meeting-data`, DynamoDB Stream initial trigger, `syncRevision`, current-state reconciliation, at-most-one active Google event, EventBridge Scheduler retry schedule, manual retry, UX, security, and observability. Runtime implementation and AWS verification remain incomplete.

## Decision authority

The authority classification remains useful architecture context, although the required cross-module choices are now accepted.

| Decision                           | Original authority boundary          | Current outcome                   | Why cross-module review mattered           |
| ---------------------------------- | ------------------------------------ | --------------------------------- | ------------------------------------------ |
| First-party web sends `version`    | M2-owned                             | Accepted and retained             | M2 controls its client                     |
| Organizer equals creator           | M2-led, cross-module review required | Option 1A accepted                | M1 authorization and M4 identity           |
| Required PATCH `version`           | Shared-contract approval required    | Option 2B accepted                | Breaking API and caller impact             |
| Public Meeting page response       | Shared-contract approval required    | Option 3A accepted                | M3, M5, Dashboard, and frontend impact     |
| M2-M4 eventual consistency         | Cross-module approval required       | Option 4A runtime design accepted | Shared lifecycle and external side effects |
| Internal repository implementation | M2-owned                             | Remains M2-owned                  | No public behavior change by itself        |
| DynamoDB schema/GSI                | Infra/data approval required         | Not changed by this decision      | Shared infrastructure                      |

Acceptance of the choices authorizes coordinated implementation planning; it does not mean the implementation follow-ups are already complete.

## Decision 1 rationale and alternatives

Option 1A matches current code, prevents organizer identity spoofing, avoids an active-member selector and transfer semantics, and keeps the MVP creator/organizer identity unambiguous.

### Alternatives considered

1. **Option 1B - select another active member as organizer:** not selected. It requires M1 membership rules, frontend selection, M4 credential ownership, changed permissions, audit history, and persistence semantics.
2. **Organizer transfer after creation:** not selected for MVP. It requires authorization, confirmation UX, Google-event ownership, concurrency, permission, and audit rules.
3. **Independent organizer role:** not selected. No current source defines that additional role lifecycle.

## Decision 2 rationale and alternatives

Option 2B closes the stale-client gap consistently for all Meeting PATCH callers and makes the client expected version the public concurrency contract.

### Alternatives considered

1. **Keep version optional permanently:** not selected because stale drafts can overwrite later state.
2. **Previous two-phase compatibility proposal:** not selected. The accepted choice requires version immediately in the coordinated implementation milestone.
3. **`ETag`/`If-Match`:** not selected for the MVP because it introduces a different header contract without a current repository convention.

### Implementation checklist

- [ ] Make `UpdateMeetingRequest.version` required.
- [ ] Require `version` in the PATCH Zod schema.
- [ ] Add missing-version validation test.
- [ ] Retain/add stale-version `409` test.
- [ ] Ensure every Meeting PATCH caller sends version.
- [ ] Remove persisted-version fallback.
- [ ] Update API contract in the implementation PR.

## Decision 3 rationale, consumer impact, and alternatives

Option 3A resolves the mismatch where repository pagination exists but the public API silently returns only the first page as an array. Coordinated migration prevents array consumers from breaking or silently truncating data.

### Consumer impact matrix

| Consumer                | Accepted requirement                             | Migration risk                                |
| ----------------------- | ------------------------------------------------ | --------------------------------------------- |
| M2 Meeting timeline     | Load more or equivalent pagination               | Direct response change breaks array rendering |
| M3 Task selector        | Load all Meetings required by the selector       | First page hides choices                      |
| M5 multi-meeting/RAG    | Never silently use only page one                 | Incomplete selected/all-Meeting behavior      |
| Dashboard               | Do not derive total from one page `items.length` | Incorrect Meeting total                       |
| `MeetingAccessBoundary` | Keep single-ID detail boundary                   | No list-response impact                       |

### Alternatives considered

1. **Parallel new paginated endpoint:** not selected. It duplicates semantics; reconsideration needs a newly accepted change after a mandatory implementation obstacle is found.
2. **Keep the unpaginated array response:** not selected because the repository already limits results and the API can silently truncate.
3. **New API version:** not selected because the repository has no current general versioning convention.

## M2-M4 rationale and alternatives

Option 4A preserves an internally successful Meeting mutation when an external provider is unavailable, while making external side effects observable and retryable.

### Alternatives considered

1. **All-or-nothing rollback of the internal Meeting when Google sync fails:** not selected. An external failure does not roll back the internal lifecycle.
2. **Treat a failed sync as completed without stored error/retry:** not selected because it hides divergence and prevents recovery.

## Required implementation follow-ups

Do not implement any follow-up on this documentation branch.

### Follow-up 1 - Required PATCH version

Proposed branch: `fix/m2-require-update-version`

Scope: required DTO; required Zod schema; remove service fallback; audit/update all callers; missing-version validation; stale-version `409`; regression tests; API contract update.

### Follow-up 2 - Meeting pagination

Proposed branch: `feature/m2-meeting-pagination`

Scope: public page DTO; handler limit/cursor; opaque cursor; service preserves `nextCursor`; M2 timeline; M3 Task selector; M5 consumers; Dashboard; coordinated tests.

### Follow-up 3 - M2-M4 synchronization implementation

The runtime design is resolved in [M2–M4 synchronization](m2-m4-synchronization.md). A later implementation PR must implement its shared DTO, repository transaction, Stream worker, Google adapter, Scheduler retry, manual retry, UX, observability, IaC, deployment, and smoke verification requirements.

### Follow-up 4 - AWS deployment and smoke testing

After source and contracts are implemented and stable, deploy and smoke-test through the normal reviewed AWS process.

## Approval scope

The team accepted the following options on 2026-08-06:

- Organizer: 1A.
- PATCH version: 2B.
- Pagination: 3A.
- M2-M4 synchronization: 4A.

Relevant roles remain M1/authorization, M2, M3, M4, M5, Dashboard, API/shared-contract, and team lead/product owner. This record does not attribute approval to named individuals because the repository contains no evidence for names, signatures, emails, GitHub usernames, or detailed approval timestamps.
