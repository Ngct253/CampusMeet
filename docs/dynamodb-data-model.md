# Mô hình dữ liệu DynamoDB CampusMeet

Tài liệu này là **source of truth cho mô hình vật lý DynamoDB**. SRS vẫn mô tả các thực thể nghiệp vụ; một thực thể logic không tương ứng bắt buộc với một bảng vật lý.

## 1. Quyết định

CampusMeet dùng 5 bảng DynamoDB theo miền truy cập:

| Bảng vật lý                      | Phạm vi                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `campusmeet-<env>-identity`      | User profile, preference, Google integration reference, OAuth state và notification                                        |
| `campusmeet-<env>-collaboration` | Group, membership, invitation và audit event theo group                                                                    |
| `campusmeet-<env>-meeting-data`  | Meeting, attendee, agenda, minutes, reminder, attachment metadata, recording, consent, live session, transcript và segment |
| `campusmeet-<env>-task-data`     | Task và lịch sử thay đổi task                                                                                              |
| `campusmeet-<env>-ai-work`       | AIJob, KnowledgeSource, conversation/message/citation, task/tool proposal và idempotency record                            |

Tên thực tế ở dev:

```text
campusmeet-dev-identity
campusmeet-dev-collaboration
campusmeet-dev-meeting-data
campusmeet-dev-task-data
campusmeet-dev-ai-work
```

## 2. Vì sao 5 bảng vẫn đủ cho toàn bộ project

DynamoDB được thiết kế theo **access pattern và aggregate**, không theo quy tắc “mỗi entity một bảng”. Mỗi bảng có khóa chung:

```text
PK       partition key
SK       sort key
GSI1PK   partition key của GSI1
GSI1SK   sort key của GSI1
GSI2PK   partition key của GSI2
GSI2SK   sort key của GSI2
GSI3PK   partition key của GSI3 khi bảng cần
GSI3SK   sort key của GSI3 khi bảng cần
```

`entityType` phân biệt loại item. Prefix trong `PK`/`SK` tạo quan hệ và cho phép query bằng `begins_with`.

Ví dụ:

```text
PK=MEETING#mtg_123
SK=META

PK=MEETING#mtg_123
SK=ATTENDEE#usr_456

PK=MEETING#mtg_123
SK=MINUTES#VERSION#0003
```

Thu gọn bảng không làm mất entity. Nó chỉ đặt các item thường đọc cùng nhau gần nhau và giảm số schema/index/policy phải vận hành.

## 3. Quy ước chung

- ID phải có prefix hoặc trường `entityType` rõ ràng.
- Timestamp lưu UTC dạng ISO 8601, ví dụ `2026-07-27T09:30:00.000Z`.
- Sort key chứa timestamp phải dùng định dạng cố định để giữ thứ tự từ điển.
- Mọi item group-scoped phải có `groupId` trong payload để kiểm tra và audit.
- Không tin `userId`, `groupId` hoặc role do frontend tự khai báo; lấy identity từ JWT và kiểm tra membership ở backend.
- Dùng conditional write cho version, trạng thái và uniqueness.
- Dùng `TransactWriteItems` cho mutation phải cập nhật nhiều item atomically.
- TTL chỉ dùng cho dữ liệu tạm như OAuth state, invitation hết hạn, idempotency và notification theo retention. TTL không thay thế nghiệp vụ chuyển trạng thái.
- Không dùng `Scan` trong request nghiệp vụ bình thường.
- Binary, audio, tài liệu và normalized content nằm trong S3; DynamoDB chỉ giữ metadata/reference.
- Vector nằm trong Bedrock Knowledge Bases/S3 Vectors; không lưu embedding trong DynamoDB.

## 4. Identity table

### 4.1 Item types

| Entity             | PK                  | SK                                          | Index                                                                            |
| ------------------ | ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| User profile       | `USER#<userId>`     | `PROFILE`                                   | `GSI1PK=COGNITO#<sub>`, `GSI1SK=USER#<userId>`; `GSI2PK=EMAIL#<normalizedEmail>`, `GSI2SK=USER#<userId>` |
| User preference    | `USER#<userId>`     | `PREFERENCE`                                | Không cần                                                                        |
| Google integration | `USER#<userId>`     | `INTEGRATION#GOOGLE`                        | Có thể dùng sparse index theo trạng thái nếu cần                                 |
| Notification       | `USER#<userId>`     | `NOTIFICATION#<createdAt>#<notificationId>` | `GSI1PK=NOTIFICATION#<id>`, `GSI1SK=USER#<userId>`; khi unread dùng `GSI2PK=USER#<userId>#UNREAD` |
| OAuth state        | `OAUTH#<stateHash>` | `STATE`                                     | TTL bắt buộc                                                                     |

Google access/refresh token không đặt trực tiếp trong item nếu chưa có lớp mã hóa application phù hợp. Item nên giữ secret reference hoặc ciphertext đã mã hóa; browser không nhận refresh token.

### 4.2 Access patterns

- Lấy profile theo `userId`: `GetItem(USER#id, PROFILE)`.
- Lấy profile từ Cognito `sub`: query `GSI1` với `COGNITO#sub`.
- Lấy notification mới nhất: query partition `USER#id` với prefix `NOTIFICATION#`, descending.
- Lấy unread notification: query `GSI2` với `USER#id#UNREAD`.
- Đánh dấu đã đọc: update notification và `REMOVE GSI2PK, GSI2SK` bằng conditional update.

## 5. Collaboration table

### 5.1 Item types

| Entity      | PK                | SK                            | Index                                                        |
| ----------- | ----------------- | ----------------------------- | ------------------------------------------------------------ |
| Group       | `GROUP#<groupId>` | `META`                        | Không cần chỉ mục creator vì creator đồng thời là membership |
| Membership  | `GROUP#<groupId>` | `MEMBER#<userId>`             | `GSI1PK=USER#<userId>`, `GSI1SK=GROUP#<joinedAt>#<groupId>`  |
| Invitation  | `GROUP#<groupId>` | `INVITE#<invitationId>`       | `GSI1PK=EMAIL#<normalizedEmail>` để tra lời mời; `GSI2PK=TOKEN#<tokenHash>` để phản hồi bằng token |
| Audit event | `GROUP#<groupId>` | `AUDIT#<createdAt>#<auditId>` | Không cần                                                    |

### 5.2 Access patterns

- Lấy group và thành viên: query `PK=GROUP#id`; dùng prefix `MEMBER#` khi chỉ cần membership.
- Kiểm tra membership: `GetItem(GROUP#groupId, MEMBER#userId)`.
- Liệt kê group của user: query `GSI1` với `USER#userId`.
- Chấp nhận invitation: query `GSI2` bằng token hash, sau đó transaction:
  1. condition invitation còn `PENDING` và chưa hết hạn;
  2. update invitation thành `ACCEPTED`;
  3. put membership nếu chưa tồn tại;
  4. ghi audit event.
- Tạo group: transaction put group + membership admin + audit event.

## 6. Meeting-data table

Bảng này chứa các aggregate liên quan trực tiếp tới cuộc họp. Không phải mọi item dùng cùng một partition; transcript segment và consent có partition riêng để tránh một partition meeting trở thành document khổng lồ.

### 6.1 Meeting aggregate

| Entity                    | PK                    | SK                                      | Index                                                                                                                                 |
| ------------------------- | --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Meeting metadata          | `MEETING#<meetingId>` | `META`                                  | `GSI1PK=GROUP#<groupId>`, `GSI1SK=MEETING#<startAt>#<meetingId>`; `GSI2PK=USER#<organizerId>`, `GSI2SK=MEETING#<startAt>#<meetingId>` |
| External Google reference | cùng item meeting     | cùng item                               | `GSI3PK=EXTERNAL#GOOGLE_EVENT#<id>` hoặc `EXTERNAL#SPACE#<name>`, `GSI3SK=MEETING#<meetingId>`                                        |
| Attendee                  | `MEETING#<meetingId>` | `ATTENDEE#<userId>`                     | Không cần                                                                                                                             |
| Agenda item               | `MEETING#<meetingId>` | `AGENDA#<order>#<agendaItemId>`         | Không cần                                                                                                                             |
| Minutes version           | `MEETING#<meetingId>` | `MINUTES#VERSION#<paddedVersion>`       | Không cần                                                                                                                             |
| Reminder                  | `MEETING#<meetingId>` | `REMINDER#<runAt>#<reminderId>`         | Khi cần worker query: `GSI1PK=REMINDER_STATUS#<status>`, `GSI1SK=<runAt>#<reminderId>`                                                |
| Attachment metadata       | `MEETING#<meetingId>` | `ATTACHMENT#<createdAt>#<attachmentId>` | Có thể dùng sparse `GSI1PK=ATTACHMENT_STATUS#<status>` cho quarantine worker                                                          |
| Recording metadata        | `MEETING#<meetingId>` | `RECORDING#<createdAt>#<recordingId>`   | Không cần                                                                                                                             |
| Live session              | `MEETING#<meetingId>` | `LIVE_SESSION#<sessionId>`              | TTL chỉ cho session tạm đã đóng nếu retention cho phép                                                                                |
| Transcript reference      | `MEETING#<meetingId>` | `TRANSCRIPT#<version>#<transcriptId>`   | Không cần                                                                                                                             |

Một item chỉ xuất hiện trong GSI khi có đủ key của index. Việc GSI1 được dùng cho cả meeting timeline, reminder worker và attachment worker là index overloading có chủ đích; prefix khác nhau ngăn truy vấn lẫn dữ liệu.

### 6.2 Recording consent aggregate

| Entity                    | PK                        | SK                 |
| ------------------------- | ------------------------- | ------------------ |
| Recording metadata lookup | `RECORDING#<recordingId>` | `META`             |
| Consent record            | `RECORDING#<recordingId>` | `CONSENT#<userId>` |

Consent phải giữ actor, consent text/version, source capture, timestamp và retention decision. Không dùng consent item để suy diễn speaker identity.

### 6.3 Transcript aggregate

| Entity              | PK                          | SK                                     |
| ------------------- | --------------------------- | -------------------------------------- |
| Transcript metadata | `TRANSCRIPT#<transcriptId>` | `META`                                 |
| Final segment       | `TRANSCRIPT#<transcriptId>` | `SEGMENT#<paddedSequence>#<segmentId>` |
| Edit/version event  | `TRANSCRIPT#<transcriptId>` | `EDIT#<createdAt>#<eventId>`           |
| Approval event      | `TRANSCRIPT#<transcriptId>` | `APPROVAL#<createdAt>#<eventId>`       |

Quy tắc transcript:

- Partial result không lưu.
- Final segment ghi idempotent theo `sessionId + sequence` hoặc `ResultId`.
- Segment giữ timestamp, confidence, language code và `Speaker N`; không tự ánh xạ danh tính.
- Optimistic update dùng `version` và condition expression.
- Approval chỉ do Organizer hoặc Group Admin thực hiện trên `expectedVersion`; metadata giữ `approvedVersion`, `approvedBy`, `approvedAt` và idempotency reference.
- Approval retry không tạo AIJob/KnowledgeSource version trùng; chỉnh sửa transcript sau approval tạo version mới chưa duyệt và làm KnowledgeSource cũ `STALE` khi version mới được ingest.
- Query segment theo trang bằng `PK=TRANSCRIPT#id` và sort-key range.
- Audio/raw chunk nằm trong S3.

## 7. Task-data table

| Entity        | PK              | SK                            | Index                                                                            |
| ------------- | --------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Task metadata | `TASK#<taskId>` | `META`                        | `GSI1PK=GROUP#<groupId>`, `GSI1SK=STATUS#<status>#DUE#<dueAt>#TASK#<taskId>`     |
| Task metadata | cùng item       | cùng item                     | `GSI2PK=USER#<assigneeId>`, `GSI2SK=DUE#<dueAt>#TASK#<taskId>`                   |
| Task metadata | cùng item       | cùng item                     | Khi có meeting: `GSI3PK=MEETING#<meetingId>`, `GSI3SK=TASK#<createdAt>#<taskId>` |
| Task history  | `TASK#<taskId>` | `EVENT#<createdAt>#<eventId>` | Không cần                                                                        |

Access patterns:

- Direct get/update task bằng `TASK#id/META`.
- Dashboard nhóm theo trạng thái và hạn: query `GSI1`.
- Dashboard cá nhân: query `GSI2`.
- Liệt kê task sinh từ meeting: query `GSI3`.
- Update status dùng conditional expression để tránh ghi đè version cũ.

Với task không có `dueAt`, item không lưu trường `dueAt`; riêng `GSI1SK` và `GSI2SK` dùng sentinel `9999-12-31T23:59:59.999Z` tại vị trí `<dueAt>`. Sentinel là data-key contract để task không hạn nằm sau task có hạn và không được trả ra API.

## 8. AI-work table

### 8.1 Item types

| Entity                   | PK                              | SK                                | Index                                                                                                                |
| ------------------------ | ------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| AIJob metadata           | `AIJOB#<aiJobId>`               | `META`                            | `GSI1PK=GROUP#<groupId>`, `GSI1SK=AIJOB#<createdAt>#<id>`; `GSI2PK=AIJOB_STATUS#<status>`, `GSI2SK=<updatedAt>#<id>` |
| AIJob event/attempt      | `AIJOB#<aiJobId>`               | `EVENT#<createdAt>#<eventId>`     | Không cần                                                                                                            |
| Knowledge source version | `SOURCE#<sourceId>`             | `VERSION#<paddedVersion>`         | `GSI1PK=GROUP#<groupId>`, `GSI1SK=SOURCE#<meetingId>#<sourceType>#<id>#<version>`                                    |
| Conversation metadata    | `CONVERSATION#<conversationId>` | `META`                            | `GSI1PK=USER#<userId>`, `GSI1SK=CONVERSATION#<updatedAt>#<id>`                                                       |
| Message                  | `CONVERSATION#<conversationId>` | `MESSAGE#<createdAt>#<messageId>` | Không cần                                                                                                            |
| Citation                 | `CONVERSATION#<conversationId>` | `CITATION#<messageId>#<order>`    | Không cần                                                                                                            |
| Task/tool proposal       | `PROPOSAL#<proposalId>`         | `META`                            | `GSI1PK=USER#<userId>`, `GSI1SK=PROPOSAL#<status>#<createdAt>#<id>`                                                  |
| Proposal execution       | `PROPOSAL#<proposalId>`         | `EXECUTION`                       | Không cần                                                                                                            |
| Idempotency result       | `IDEMPOTENCY#<scope>#<keyHash>` | `RESULT`                          | TTL bắt buộc                                                                                                         |

### 8.2 Phạm vi chức năng AI

Thiết kế này bao phủ đầy đủ:

- presigned upload và complete verification;
- Attachment, Recording và Consent;
- live transcription session;
- Transcript và TranscriptSegment;
- AIJob/Step Functions progress;
- KnowledgeSource và ingestion status;
- meeting chat, group RAG và conversation history;
- citation ổn định tới file/meeting/transcript segment;
- minutes/action-item draft;
- TaskProposal và ToolProposal;
- idempotency, retry và one-time confirmation.

`KnowledgeSource` chỉ là control-plane metadata. Nội dung normalized nằm ở:

```text
s3://<user-content-bucket>/kb/<groupId>/<meetingId>/<sourceId>/v<version>/content.txt
```

Bedrock retrieval phải filter `groupId` được backend xác thực và `approved=true` trước khi model nhận chunk.

## 9. Transaction quan trọng

### Tạo group

```text
Put GROUP META
Put creator MEMBER as ADMIN
Put AUDIT event
```

### Chấp nhận invitation

```text
Condition invitation=PENDING và chưa hết hạn
Update invitation=ACCEPTED
Put membership nếu chưa có
Put audit event
```

### Hoàn tất upload

```text
Condition attachment=PENDING_UPLOAD hoặc VALIDATING
Update attachment=READY
Put AIJOB META nếu chưa tồn tại
Put IDEMPOTENCY result
Start Step Functions sau khi transaction thành công
```

Không gọi service ngoài bên trong transaction. Google Calendar, Scheduler, S3, Transcribe và Bedrock dùng trạng thái nội bộ + idempotency để retry an toàn.

### Xác nhận proposal

```text
Condition proposal=PENDING và version khớp
Update proposal=EXECUTING
Thực thi API nghiệp vụ chuẩn
Update proposal=EXECUTED + result reference
```

Nếu thao tác nghiệp vụ và proposal nằm khác bảng, dùng transaction cho phần DynamoDB có thể transaction; service ngoài phải theo saga/idempotency, không giả vờ có distributed transaction.

## 10. Ranh giới dữ liệu ngoài DynamoDB

| Dữ liệu                             | Nơi lưu                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| Frontend static                     | S3 private + CloudFront                                        |
| Audio, recording, attachment binary | S3 user-content private                                        |
| Normalized text/chunk source        | S3 data-source prefix                                          |
| Vector                              | Bedrock Knowledge Bases + S3 Vectors                           |
| Secret Google OAuth                 | Secrets Manager hoặc SSM SecureString                          |
| Application log/metric              | CloudWatch                                                     |
| Phân tích ad-hoc về sau             | Export S3 + Athena, không dùng Athena làm operational database |

## 11. Quy trình phát triển của nhóm

- Unit test: repository in-memory/fake.
- Local integration: DynamoDB Local với cùng 5 table và key contract.
- Shared AWS dev: chỉ smoke/integration test; mỗi item test có `createdBy` và prefix ID của thành viên.
- Chỉ owner infra thay đổi `infra/data-foundation.yaml`.
- Developer không tạo/sửa index trực tiếp trong Console.
- Lambda dùng IAM execution role; không lưu access key trong `.env`.
- Developer local dùng AWS profile riêng hoặc DynamoDB Local.

Biến môi trường backend:

```dotenv
IDENTITY_TABLE=campusmeet-dev-identity
COLLABORATION_TABLE=campusmeet-dev-collaboration
MEETING_DATA_TABLE=campusmeet-dev-meeting-data
TASK_DATA_TABLE=campusmeet-dev-task-data
AI_WORK_TABLE=campusmeet-dev-ai-work
```

## 12. Điều kiện hoàn thành data layer

Data layer chỉ được đánh dấu hoàn thành khi:

- CloudFormation tạo đúng 5 bảng và không tạo thêm bảng ngoài thiết kế;
- verify script đạt;
- API có repository thật, không còn `NotImplementedError` ở vertical slice được công bố;
- tạo group transaction thành công;
- membership cross-group bị từ chối;
- meeting/minutes/reminder đọc ghi đúng;
- dashboard task dùng Query/GSI, không Scan;
- upload complete tạo đúng một AIJob khi retry;
- final transcript segment idempotent;
- RAG không retrieve dữ liệu group khác.
