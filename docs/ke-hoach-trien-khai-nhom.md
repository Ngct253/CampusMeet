# Kế hoạch triển khai CampusMeet cho nhóm 5 người

Kế hoạch này chuyển repository hiện tại thành các vertical slice có thể triển khai và demo. Phạm vi nghiệp vụ logic do [SRS](CampusMeet-SRS.md) quyết định; HTTP contract nằm trong [API contract](api-contract.md); mô hình vật lý DynamoDB nằm trong [DynamoDB data model v2](dynamodb-data-model.md).

## 1. Trạng thái nền tảng chung

- Cognito sign-up, confirmation, sign-in, sign-out và protected route đã có nền tảng/kiểm thử integration.
- Frontend nghiệp vụ vẫn còn mock ở nhiều feature.
- API nghiệp vụ và repository thật còn chưa hoàn thiện.
- Data foundation v2 đã chốt 5 bảng vật lý; 17 bảng legacy phải audit/backup trước khi cleanup.
- M5 giữ đầy đủ upload an toàn, live transcription, transcript editor, AIJob, KnowledgeSource, Bedrock RAG nhiều meeting, citation và proposal có xác nhận.
- Không owner nào tự tạo table/GSI bằng Console.

## 2. Năm bảng dùng chung

| Bảng | Owner sử dụng chính | Dữ liệu |
| --- | --- | --- |
| `identity` | M1/M4/M5 | User, preference, Google integration reference, OAuth state, notification |
| `collaboration` | M1; mọi owner đọc membership | Group, membership, invitation, audit |
| `meeting-data` | M2/M3/M4/M5 | Meeting, agenda, attendee, minutes, reminder, attachment, recording, consent, live session, transcript/segment |
| `task-data` | M3; M5 tạo proposal gọi Task API | Task, task history và dashboard indexes |
| `ai-work` | M5 | AIJob, KnowledgeSource, conversation/message/citation, task/tool proposal, idempotency |

Nhiều repository có thể dùng cùng một bảng nhưng vẫn tách theo domain. Handler không query DynamoDB trực tiếp.

## 3. Phân công ownership

| Thành viên | Outcome chịu trách nhiệm | Phụ thuộc chính |
| --- | --- | --- |
| M1 | Group, membership, invitation và authorization boundary | Cung cấp membership check cho M2–M5 |
| M2 | Meeting nội bộ, agenda, attendee, lifecycle | Dùng membership M1; cung cấp meeting boundary cho M3–M5 |
| M3 | Minutes, task, dashboard, notification core | Dùng meeting M2 và active member M1 |
| M4 | Google OAuth, Calendar/Meet sync và artifact reference | Dùng meeting lifecycle; phối hợp secret/runtime với infra |
| M5 | Upload, recording consent, live transcript, AIJob, RAG, citation, proposal và AI infrastructure | Dùng membership, meeting và Task/Minutes API chuẩn |

Ownership là trách nhiệm outcome, không phải độc quyền file. Shared contracts, router, IAM và IaC luôn cần review chéo.

## 4. Quy tắc làm song song

1. Mỗi issue/PR chỉ chứa một vertical slice hoặc một contract change rõ ràng.
2. Contract PR merge sớm trước UI/API implementation dài.
3. Khi dependency chưa xong, dùng fake adapter/repository đúng port trong test/local; không hard-code mock vào production handler.
4. Không sửa `infra/data-foundation.yaml`, shared DTO, router chung hoặc error format mà không thông báo owner liên quan.
5. Mọi group-scoped request lấy identity từ JWT rồi kiểm tra membership/role ở backend.
6. Mọi list endpoint dùng Query/GSI và pagination; không dùng Scan làm đường request chính.
7. Mutation có retry phải có idempotency/conditional write.
8. Không deploy từ branch chưa review; shared AWS dev chỉ owner infra thực hiện.

## 5. M1 — Group, membership và invitation

### Kết quả phải bàn giao

```text
Đăng nhập
→ tạo group
→ creator trở thành ADMIN
→ mời thành viên
→ thành viên chấp nhận/từ chối
→ mọi API khác kiểm tra membership/role dùng chung
```

### Code/contract

- Shared: `Group`, `Membership`, `Invitation`, role/status và request/response DTO.
- Frontend: group list/detail/create, member list, invitation state.
- Backend: group/membership/invitation handlers và application services.
- Repository: `collaboration` table.

### Key/access patterns

- Group: `GROUP#id / META`.
- Membership: `GROUP#id / MEMBER#userId`.
- User groups: GSI1 `USER#userId`.
- Invitation lookup: GSI2 `TOKEN#tokenHash`.
- Audit: `GROUP#id / AUDIT#timestamp#id`.

### Transaction bắt buộc

Tạo group:

```text
Put group
Put creator membership ADMIN
Put audit event
```

Chấp nhận invitation:

```text
Condition invitation=PENDING và chưa hết hạn
Update invitation=ACCEPTED
Put membership nếu chưa có
Put audit event
```

### Test tối thiểu

- Tạo group thành công.
- Tên không hợp lệ bị từ chối.
- Retry tạo không tạo duplicate.
- User ngoài group nhận `403`.
- Không thể xóa/hạ quyền admin cuối cùng.
- Token invitation hết hạn/revoked không tạo membership.

## 6. M2 — Meeting nội bộ

### Kết quả phải bàn giao

```text
Active group member/admin
→ tạo meeting
→ agenda + attendee
→ sửa/hủy idempotent
→ query timeline group
→ meeting boundary dùng được cho M3–M5
```

### Code/contract

- Shared: meeting request/response, lifecycle, agenda, attendee, organizer.
- Frontend: meeting form/list/detail/cancel.
- Backend: meeting handlers/application service.
- Repository: `meeting-data` table.

### Key/access patterns

- Meeting: `MEETING#id / META`.
- Attendee: `MEETING#id / ATTENDEE#userId`.
- Agenda: `MEETING#id / AGENDA#order#id`.
- Timeline group: GSI1 `GROUP#groupId / MEETING#startAt#id`.
- Organizer timeline: GSI2 `USER#organizerId`.
- Google external lookup: sparse GSI3.

### Test tối thiểu

- End time sau start time.
- Organizer/attendee phải là active member.
- Hủy meeting lần hai không tạo side effect mới.
- Query group khác bị từ chối.
- Không hard-delete meeting history.

## 7. M3 — Minutes, task, dashboard và notification core

### Kết quả phải bàn giao

```text
Meeting
→ lưu minutes version
→ user xác nhận action item
→ tạo task
→ cập nhật TODO/DOING/DONE
→ dashboard thay đổi
→ notification hiển thị đúng user
```

### Code/contract

- Shared: Minutes, Decision, ActionItem, Task, Dashboard DTO, Notification.
- Frontend: minutes editor, task list/update, dashboard, notifications.
- Backend: minutes/task/dashboard/notification handlers và services.
- Repository:
  - minutes trong `meeting-data`;
  - tasks trong `task-data`;
  - notifications trong `identity`.

### Access patterns

- Minutes versions: `MEETING#id / MINUTES#VERSION#n`.
- Task: `TASK#id / META`.
- Group dashboard: task GSI1 group/status/due.
- Personal dashboard: task GSI2 assignee/due.
- Tasks from meeting: task GSI3.
- Notification: `USER#id / NOTIFICATION#createdAt#id`; unread sparse GSI2.

### Test tối thiểu

- Assignee phải là active member.
- `DONE` lưu `completedAt`; reopen xử lý version đúng.
- Overdue được tính, không lưu status `OVERDUE`.
- Dashboard không Scan.
- Mark-read idempotent.
- Group khác không đọc minutes/task.

M5 không ghi task hoặc minutes chính thức trực tiếp. AI chỉ tạo draft/proposal và gọi API M3 sau khi user xác nhận.

## 8. M4 — Google Calendar và Meet

### Kết quả phải bàn giao

```text
User kết nối Google
→ meeting nội bộ đã hợp lệ
→ tạo/update/cancel Calendar event
→ lưu googleSyncStatus + external refs
→ retry không tạo event trùng
→ artifact có thì đồng bộ reference, không có thì dùng fallback M5
```

### Code/contract

- Shared: Google integration status, connect/callback/sync DTO.
- Frontend: connect/disconnect/status/retry UI.
- Backend: OAuth start/callback/disconnect và meeting sync application service.
- Adapter: Google Calendar/Meet REST.
- Data:
  - integration reference/ciphertext secret reference trong `identity`;
  - Google event/space/conference reference trong meeting META của `meeting-data`.

### Quy tắc

- Refresh token không trả browser hoặc log.
- Secret nằm Secrets Manager/SSM hoặc ciphertext được mã hóa phù hợp.
- `meetingStatus` và `googleSyncStatus` độc lập.
- Chỉ hiển thị Meet URL khi `READY`.
- Retry dùng idempotency/request ID; không tạo event mới mù quáng.
- Google artifact không có là kết quả hợp lệ, không làm mất meeting/minutes/task nội bộ.

### Test tối thiểu

- OAuth state không hợp lệ/hết hạn bị từ chối.
- Retry timeout không tạo hai event.
- Token hết hạn chuyển đúng trạng thái cần kết nối lại.
- Không lộ token trong response/log.

## 9. M5 — Upload, live transcript và AI đầy đủ

Nguồn chi tiết: [Kế hoạch M5](ke-hoach-m5-upload-transcript-ai.md).

### Demo bắt buộc

```text
Meeting + active membership
→ consent/cấp quyền capture
→ live transcription chạy nền
→ final segment có timestamp/confidence/language/Speaker N
→ transcript editor/version
→ recording/file upload trực tiếp S3
→ AIJob bất đồng bộ
→ normalized approved source
→ Knowledge Base/S3 Vectors
→ RAG current/selected/whole-group có citation
→ minutes/task proposal
→ user preview + xác nhận
→ API nghiệp vụ chuẩn thực thi
```

### Phạm vi không được mất khi thu gọn bảng

- Attachment metadata và presigned upload.
- Recording, consent record và retention.
- LiveTranscriptionSession, heartbeat/reconnect/sequence.
- Transcript metadata, final segment và edit history.
- AIJob state/attempt/progress/error an toàn.
- KnowledgeSource/version/ingestion status.
- Conversation, message và citation.
- TaskProposal/ToolProposal, one-time confirmation và idempotency.
- RAG nhiều meeting trong cùng group.
- Kiểm tra chống retrieval chéo group.

### Nơi lưu

| Dữ liệu | Nơi lưu |
| --- | --- |
| Attachment/recording/live/transcript metadata | `meeting-data` |
| Final transcript segment | `meeting-data`, partition `TRANSCRIPT#id` |
| AIJob/KnowledgeSource/conversation/citation/proposal | `ai-work` |
| Binary/audio/raw recording | S3 private |
| Normalized source | S3 data-source prefix |
| Vector | Bedrock Knowledge Bases + S3 Vectors |
| Log/metric | CloudWatch, không chứa content nhạy cảm |

### Quy tắc live transcript

- Browser chỉ nhận signed streaming connection ngắn hạn sau authorization/consent/quota check.
- Audio không đi qua API Gateway/Lambda payload.
- Partial result chỉ hiển thị tạm; không persist/ingest/citation.
- Final segment idempotent theo `sessionId + sequence` hoặc `ResultId`.
- Không tự ánh xạ `Speaker N` sang danh tính.
- Khi live source lỗi, chức năng AI phụ thuộc nội dung trả trạng thái chưa đủ dữ liệu; không suy đoán từ agenda/participant metadata.

### Quy tắc RAG

- Current meeting có thể đọc final live segment được phép trực tiếp.
- Chỉ approved file/transcript/minutes mới ingest cho selected/whole-group.
- Retrieval filter `authorized groupId`, `approved=true` và optional meeting set trước model.
- Citation phải trỏ nguồn nội bộ ổn định; không trả raw S3 key/URL nhạy cảm.
- Thiếu nguồn trả `insufficientContext=true`.

### Test tối thiểu

- Binary không đi qua API.
- File sai MIME/size/checksum bị từ chối.
- Complete upload retry chỉ tạo một AIJob.
- Segment retry không duplicate.
- Optimistic transcript edit version cũ trả conflict.
- Job retry/backoff/timeout chuyển đúng trạng thái.
- Group A không retrieve source group B.
- Proposal chỉ execute một lần và kiểm tra lại quyền lúc confirm.

## 10. Infrastructure owner và database workflow

Owner infra/M5 review chung chịu trách nhiệm:

- `infra/data-foundation.yaml`;
- IAM roles/policies;
- change set;
- shared dev deployment;
- audit/backup/cleanup;
- cost/retention/alarms.

Developer workflow:

```text
Use case/access pattern
→ shared contract
→ in-memory unit test
→ DynamoDB Local integration
→ PR
→ CI
→ owner deploy shared AWS dev
→ smoke test
```

Không developer nào cần `DATABASE_URL`. Local AWS SDK dùng DynamoDB Local hoặc AWS profile; Lambda dùng IAM execution role và 5 tên bảng env.

## 11. Trình tự merge đề xuất

1. Data model/IaC v2 và docs.
2. Shared error/pagination/idempotency conventions.
3. M1 membership/authorization boundary.
4. M2 meeting boundary.
5. M3 minutes/task/dashboard core.
6. M4 Google integration dựa trên meeting thật.
7. M5 có thể làm spike streaming/contract song song; production handlers chỉ nối khi membership/meeting repository thật sẵn sàng.
8. Notification/reminder integration.
9. Full smoke/security/cost/cleanup rehearsal.

M5 không phải chờ toàn bộ UI core để làm provider spike, fake repository và local workflow; nhưng deployment thật không được bypass authorization boundary của M1/M2.

## 12. Mốc triển khai

| Mốc | Điều kiện |
| --- | --- |
| Data foundation | 5 bảng deploy/verify; 17 bảng legacy audit/backup |
| Core 1 | Auth → group → invitation/membership |
| Core 2 | Group → meeting → minutes → task → dashboard |
| Integration | Google Calendar/Meet status/retry + reminder/notification |
| AI source | consent/upload/live segment/transcript editor/AIJob |
| AI grounded | KnowledgeSource ingestion + current/selected/whole-group RAG + citation |
| Proposal | minutes/task proposal preview/confirm/idempotency |
| Release candidate | Cross-group tests, logs/alarms, budget, retention và cleanup rehearsal đạt |

## 13. Definition of Done cho mỗi feature

Một feature chỉ hoàn thành khi có:

- shared contract được review;
- UI loading/empty/error/permission state;
- handler mỏng và application service rõ;
- repository/integration adapter thật hoặc fake chỉ giới hạn test/local;
- authorization server-side;
- happy-path test;
- ít nhất một negative/security test;
- idempotency/version khi có retry/concurrency;
- docs/API/data model cập nhật khi contract thay đổi;
- logs không chứa secret/content nhạy cảm;
- cost/cleanup impact được nêu nếu thêm AWS resource.

## 14. Quy tắc branch và PR

- Branch từ `main` mới nhất.
- Không để branch dài chứa nhiều chức năng độc lập.
- PR mô tả mục tiêu, contract, data access pattern, test, migration và rollback.
- Không commit `.env.local`, token, access key, secret hoặc dữ liệu thật.
- Không merge khi CI đỏ hoặc physical schema khác `docs/dynamodb-data-model.md`.
- Mọi thay đổi table/GSI phải sửa đồng thời IaC, validation script và migration/runbook.
