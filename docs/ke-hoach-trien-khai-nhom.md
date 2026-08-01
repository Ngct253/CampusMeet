# Kế hoạch triển khai CampusMeet cho nhóm 5 người

Kế hoạch này chuyển repository hiện tại thành các vertical slice có thể triển khai và demo. Phạm vi nghiệp vụ logic do [SRS](CampusMeet-SRS.md) quyết định; HTTP contract nằm trong [API contract](api-contract.md); mô hình vật lý DynamoDB nằm trong [mô hình dữ liệu DynamoDB](dynamodb-data-model.md).

## 1. Trạng thái nền tảng chung

- Cognito sign-up, confirmation, sign-in, sign-out và protected route đã có nền tảng/kiểm thử integration.
- Frontend nghiệp vụ vẫn còn mock ở nhiều feature.
- API nghiệp vụ và repository thật còn chưa hoàn thiện.
- Data foundation gồm 5 bảng vật lý đã deploy và verify.
- Không thành viên nào tự tạo bảng/GSI bằng Console.

## 2. Năm bảng dùng chung

| Bảng            | Người sử dụng chính               | Dữ liệu                                                                                                        |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `identity`      | M1/M4                             | User, preference, Google integration reference, OAuth state, notification                                      |
| `collaboration` | M1; mọi thành viên đọc membership | Group, membership, invitation, audit                                                                           |
| `meeting-data`  | M2/M3/M4                          | Meeting, agenda, attendee, minutes, reminder, attachment, recording, consent, live session, transcript/segment |
| `task-data`     | M3                                | Task, task history và dashboard indexes                                                                        |
| `ai-work`       | M3/M4/M5                          | AIJob, KnowledgeSource, conversation/message/citation, task/tool proposal, idempotency                         |

Nhiều repository có thể dùng cùng một bảng nhưng vẫn tách theo domain. Handler không query DynamoDB trực tiếp.

## 3. Phân công trách nhiệm

| Thành viên | Chức năng sở hữu                                                                       | Tỷ lệ | Đầu ra cho thành viên khác                                         |
| ---------- | -------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| M1         | Identity, group, membership, invitation, authorization và notification inbox           |   20% | Membership lookup, authorization helper và notification repository |
| M2         | Meeting, agenda, attendee, consent, live STT, recording và final transcript segment    |   20% | Meeting boundary và nguồn transcript ổn định                       |
| M3         | Transcript editor, minutes, task, dashboard và xác nhận proposal                       |   20% | Task/Minutes API chuẩn; proposal chỉ gọi API này sau xác nhận      |
| M4         | Google OAuth/Calendar/Meet, attachment upload, AIJob orchestration, reminder và email  |   20% | Approved source + AIJob cho M5; external references cho M2         |
| M5         | KnowledgeSource, Bedrock ingestion, RAG nhiều meeting, chat, citation và sinh bản nháp |   20% | Grounded answer/draft có citation cho UI và M3                     |

Người phụ trách chịu trách nhiệm kết quả, không độc quyền tệp. Dữ liệu dùng chung, router, IAM và IaC luôn cần review chéo.

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
→ notification inbox đọc/đánh dấu đã đọc đúng user
```

### Tệp và việc cần làm

- Shared: sửa `packages/shared/src/types/` và `packages/shared/src/dto/` cho `Group`, `Membership`, `Invitation`, profile, notification và role/status.
- Frontend: làm group/member/invitation tại `apps/web/src/features/groups/`; làm notification inbox tại `apps/web/src/features/notifications/`.
- Backend: thay skeleton group/notification trong `services/api/src/handlers/`; đặt business rule trong application service, không đặt trong React hoặc handler.
- Repository: triển khai group/membership/invitation ở bảng `collaboration`; profile/notification ở bảng `identity` trong `services/api/src/repositories/`.

### Khóa và cách truy vấn

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

### Kiểm thử tối thiểu

- Tạo group thành công.
- Tên không hợp lệ bị từ chối.
- Retry tạo không tạo duplicate.
- User ngoài group nhận `403`.
- Không thể xóa/hạ quyền admin cuối cùng.
- Token invitation hết hạn/revoked không tạo membership.
- User không đọc/mark-read notification của người khác.

## 6. M2 — Meeting nội bộ

### Kết quả phải bàn giao

```text
Active group member/admin
→ tạo meeting
→ agenda + attendee
→ sửa/hủy idempotent
→ query timeline group
→ consent + live session hợp lệ
→ browser capture audio và gửi Transcribe
→ final segment/recording được lưu idempotent
→ meeting boundary dùng được cho M3–M5
```

### Tệp và việc cần làm

- Shared: meeting, consent, live-session, recording và transcript-segment DTO trong `packages/shared/src/`.
- Frontend: meeting CRUD và live-status/capture trong `apps/web/src/features/meetings/`; audio chỉ bắt đầu sau user gesture và consent.
- Backend: meeting handlers cùng live-session/signed Transcribe URL/final-segment API trong `services/api/src/handlers/` và application service tương ứng.
- Repository: meeting/agenda/attendee/consent/live-session/recording/final segment trong bảng `meeting-data`.

### Khóa và cách truy vấn

- Meeting: `MEETING#id / META`.
- Attendee: `MEETING#id / ATTENDEE#userId`.
- Agenda: `MEETING#id / AGENDA#order#id`.
- Timeline group: GSI1 `GROUP#groupId / MEETING#startAt#id`.
- Organizer timeline: GSI2 `USER#organizerId`.
- Google external lookup: sparse GSI3.

### Kiểm thử tối thiểu

- End time sau start time.
- Organizer/attendee phải là active member.
- Hủy meeting lần hai không tạo side effect mới.
- Query group khác bị từ chối.
- Không hard-delete meeting history.
- Chưa consent không được cấp signed streaming URL.
- Partial segment không persist; retry final segment không tạo bản ghi trùng.

## 7. M3 — Transcript editor, minutes, task và dashboard

### Kết quả phải bàn giao

```text
Meeting
→ sửa transcript theo optimistic version
→ lưu minutes version
→ user xác nhận action item
→ tạo task
→ cập nhật TODO/DOING/DONE
→ dashboard thay đổi
→ AI draft chỉ được áp dụng sau preview + xác nhận
```

### Tệp và việc cần làm

- Shared: Transcript edit, Minutes, Decision, ActionItem, Task, Dashboard và Proposal confirmation DTO trong `packages/shared/src/`.
- Frontend: transcript editor, minutes editor, task list/update, dashboard và proposal preview/confirm trong `apps/web/src/features/`.
- Backend: transcript edit, minutes/task/dashboard và proposal-confirm handlers/services trong `services/api/src/`.
- Repository:
  - transcript version/edit history trong `meeting-data`;
  - minutes trong `meeting-data`;
  - tasks trong `task-data`;
  - proposal state/execution reference trong `ai-work`.

### Cách truy vấn

- Minutes versions: `MEETING#id / MINUTES#VERSION#n`.
- Task: `TASK#id / META`.
- Group dashboard: task GSI1 group/status/due.
- Personal dashboard: task GSI2 assignee/due.
- Tasks from meeting: task GSI3.
- Proposal: `PROPOSAL#id / META|EXECUTION`; confirm phải kiểm tra lại quyền và version.

### Kiểm thử tối thiểu

- Assignee phải là active member.
- `DONE` lưu `completedAt`; reopen xử lý version đúng.
- Overdue được tính, không lưu status `OVERDUE`.
- Dashboard không Scan.
- Transcript update bằng version cũ trả `409`.
- Proposal retry chỉ thực thi Task/Minutes API một lần.
- Group khác không đọc minutes/task.

M5 không ghi task hoặc minutes chính thức trực tiếp. M5 tạo draft có citation; M3 sở hữu preview, xác nhận và gọi API nghiệp vụ chuẩn.

## 8. M4 — Google, upload, AIJob và reminder

### Kết quả phải bàn giao

```text
User kết nối Google
→ meeting nội bộ đã hợp lệ
→ tạo/update/cancel Calendar event
→ lưu googleSyncStatus + external refs
→ retry không tạo event trùng
→ artifact có thì đồng bộ reference, không có thì dùng upload fallback
→ upload file/audio trực tiếp S3
→ complete verification tạo đúng một AIJob
→ Step Functions xử lý bất đồng bộ
→ reminder tạo notification và thử gửi email
```

### Tệp và việc cần làm

- Shared: Google integration, attachment, upload-complete, AIJob và reminder DTO trong `packages/shared/src/`.
- Frontend: connect/disconnect/status/retry và upload progress/cancel/retry trong `apps/web/src/features/`.
- Backend: OAuth/meeting sync, presigned upload/complete, AIJob status và reminder handlers/services trong `services/api/src/`.
- Adapter: Google Calendar/Meet REST, S3, Step Functions, EventBridge Scheduler và SES.
- Data:
  - integration reference/ciphertext secret reference trong `identity`;
  - Google reference, attachment/reminder metadata trong `meeting-data`;
  - AIJob state/idempotency trong `ai-work`; binary/audio trong S3 private.

### Quy tắc

- Refresh token không trả browser hoặc log.
- Secret nằm Secrets Manager/SSM hoặc ciphertext được mã hóa phù hợp.
- `meetingStatus` và `googleSyncStatus` độc lập.
- Chỉ hiển thị Meet URL khi `READY`.
- Retry dùng idempotency/request ID; không tạo event mới mù quáng.
- Google artifact không có là kết quả hợp lệ, không làm mất meeting/minutes/task nội bộ.

### Kiểm thử tối thiểu

- OAuth state không hợp lệ/hết hạn bị từ chối.
- Retry timeout không tạo hai event.
- Token hết hạn chuyển đúng trạng thái cần kết nối lại.
- Không lộ token trong response/log.
- Binary không đi qua API; complete upload retry chỉ tạo một AIJob.
- Job success/failure/cancel/retry cập nhật trạng thái idempotent.
- Email lỗi không rollback notification trong ứng dụng.

## 9. M5 — Knowledge, RAG và trợ lý AI

Thiết kế contract, dữ liệu và bảo mật nằm tại [Thiết kế kỹ thuật Upload, Live Transcript và AI](thiet-ke-ky-thuat-upload-live-transcript-ai.md). Phần này chỉ nêu việc M5 phải làm.

### Kết quả phải bàn giao

```text
Approved transcript/file + active membership
→ normalize và tạo KnowledgeSource version
→ Knowledge Base/S3 Vectors
→ RAG current/selected/whole-group có citation
→ chat hoặc minutes/task draft có citation
→ chuyển draft cho proposal API của M3
```

### Tệp và việc cần làm

- Shared: `KnowledgeSource`, `GroundedAnswer`, `Citation`, conversation và draft DTO trong `packages/shared/src/`.
- Backend: ingestion, retrieval, chat và draft handlers/services trong `services/api/src/`.
- Worker: normalize source, gọi Bedrock và cập nhật trạng thái trong worker Lambda được khai báo tại `infra/template.yaml`.
- Frontend: chat, chọn phạm vi meeting, citation và trạng thái thiếu nguồn trong `apps/web/src/features/`.
- Data: metadata ở `ai-work`, normalized source ở S3, vector ở Bedrock Knowledge Bases/S3 Vectors.

### Kiểm thử tối thiểu

- Chỉ ingest source `approved=true`; version cũ chuyển `STALE`.
- Ingestion retry không tạo KnowledgeSource version trùng.
- Group A không retrieve source group B.
- Citation mở đúng meeting/file/transcript segment qua URI nội bộ.
- Draft không tự ghi minutes/task; thiếu nguồn trả `insufficientContext=true`.

## 10. Trách nhiệm hạ tầng và quy trình database

M4 sở hữu hạ tầng luồng vào; M5 sở hữu hạ tầng AI. M1 review quyền IAM có liên quan dữ liệu nhóm:

- `infra/data-foundation.yaml`;
- IAM roles/policies theo từng runtime;
- change set;
- shared dev deployment;
- audit/backup/cleanup;
- M4: S3 user-content, Scheduler, Step Functions orchestration và runtime API;
- M5: Bedrock Knowledge Base, vector store, AI Worker, AI alarms/cost/cleanup.

Developer workflow:

```text
Use case/access pattern
→ shared contract
→ in-memory unit test
→ DynamoDB Local integration
→ PR
→ CI
→ người phụ trách deploy AWS dev dùng chung
→ smoke test
```

Không developer nào cần `DATABASE_URL`. Local AWS SDK dùng DynamoDB Local hoặc AWS profile; Lambda dùng IAM execution role và 5 tên bảng env.

## 11. Trình tự merge đề xuất

1. Data model/IaC 5 bảng và docs.
2. Shared error/pagination/idempotency conventions.
3. M1 membership/authorization boundary.
4. M2 meeting boundary.
5. M3 minutes/task/dashboard core.
6. M4 Google integration dựa trên meeting thật.
7. M2 làm spike streaming song song; M4 làm upload/AIJob; M5 làm fake-provider ingestion/RAG theo contract approved source.
8. Notification/reminder integration.
9. Full smoke/security/cost/cleanup rehearsal.

M2/M4/M5 có thể dùng fake đúng port khi dependency chưa xong; deployment thật không được bypass authorization boundary của M1/M2.

## 12. Mốc triển khai

| Mốc               | Điều kiện                                                                  |
| ----------------- | -------------------------------------------------------------------------- |
| Data foundation   | 5 bảng deploy/verify, TTL/GSI/tag đúng contract                            |
| Core 1            | Auth → group → invitation/membership                                       |
| Core 2            | Group → meeting → minutes → task → dashboard                               |
| Integration       | Google Calendar/Meet status/retry + reminder/notification                  |
| AI source         | consent/upload/live segment/transcript editor/AIJob                        |
| AI grounded       | KnowledgeSource ingestion + current/selected/whole-group RAG + citation    |
| Proposal          | minutes/task proposal preview/confirm/idempotency                          |
| Release candidate | Cross-group tests, logs/alarms, budget, retention và cleanup rehearsal đạt |

## 13. Điều kiện hoàn thành cho mỗi chức năng

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
