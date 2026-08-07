# Hợp đồng API CampusMeet

## Trạng thái chung

`GET /health`, phạm vi M1 và lõi quản lý cuộc họp đã có handler thật. API đọc danh tính từ JWT Cognito, kiểm tra membership/role và thao tác trên các bảng đúng owner. Các module M2–M5 còn lại chưa được owner triển khai vẫn có thể trả `501 Not Implemented`.

Request/response types phải import từ `@campusmeet/shared`, không copy interface giữa frontend và backend.

CampusMeet web và CampusMeet Meet Add-on là hai client surface của cùng hệ thống. Add-on side panel dùng lại các endpoint bên dưới, không có API đặc quyền hoặc database riêng. `meetingId`/`meetingCode` lấy từ Meet Add-ons SDK chỉ là context để ánh xạ; backend vẫn phải xác thực JWT, tìm meeting nội bộ và kiểm tra membership/role trước khi trả dữ liệu hoặc mutation.

Khi email được mời đã có profile CampusMeet, notification lời mời được ghi cùng transaction với invitation và mở đúng `/app/invitations?invitationId=<invitationId>`; token thô không được lưu trong notification. Notification cũ chỉ tra đúng invitation của nó, không được thay bằng một invitation đang chờ khác.

Khi lời mời được chấp nhận hoặc từ chối, notification `invitation-<invitationId>` tương ứng được chuyển sang đã đọc; phản hồi lời mời không thất bại nếu notification cũ không tồn tại.

| Method    | Endpoint dự kiến                                               | Shared contract                                                    | Trạng thái hiện tại                                                     |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| GET       | `/health`                                                      | `ApiSuccessResponse<{service,status,timestamp}>`                   | Đã có health handler                                                    |
| GET/PATCH | `/me`                                                          | `UserProfile`, `UpdateProfileRequest`                              | M1 đã triển khai                                                        |
| GET/POST  | `/groups`                                                      | `CreateGroupRequest`, `GroupSummary[]`                             | M1 đã triển khai                                                        |
| GET/PATCH | `/groups/:groupId`                                             | `GroupDetails`, `CreateGroupRequest`                               | M1 đã triển khai, PATCH yêu cầu Group Admin                             |
| DELETE    | `/groups/:groupId/members/:userId`                             | `{removed:true}`                                                   | M1 đã triển khai, không cho xóa Group Admin                             |
| POST      | `/groups/:groupId/invitations`                                 | `CreateInvitationRequest`, `CreateInvitationResponse`              | M1 đã triển khai                                                        |
| GET       | `/groups/:groupId/invitations`                                 | `InvitationDetails[]`                                              | M1 đã triển khai, yêu cầu Group Admin                                   |
| POST      | `/groups/:groupId/invitations/:invitationId/revoke`            | `{revoked:true}`                                                   | M1 đã triển khai, vô hiệu hóa token cũ                                  |
| GET       | `/invitations`                                                 | `InvitationDetails[]`                                              | M1 đã triển khai theo email đăng nhập                                   |
| POST      | `/invitations/by-id/:invitationId/accept`                      | `InvitationDetails`                                                | M1 đã triển khai                                                        |
| POST      | `/invitations/by-id/:invitationId/decline`                     | `InvitationDetails`                                                | M1 đã triển khai                                                        |
| GET       | `/invitations/:token`                                          | `InvitationDetails`                                                | M1 đã triển khai                                                        |
| POST      | `/invitations/:token/accept`                                   | `InvitationDetails`                                                | M1 đã triển khai                                                        |
| POST      | `/invitations/:token/decline`                                  | `InvitationDetails`                                                | M1 đã triển khai                                                        |
| GET       | `/meetings`                                                    | `Meeting[]`                                                        | Đã triển khai, trả lịch của các nhóm người dùng đang tham gia           |
| GET/POST  | `/groups/:groupId/meetings`                                    | `MeetingTimelineResponse`, `CreateMeetingRequest`                  | Đã triển khai pagination; POST yêu cầu Group Admin và `Idempotency-Key` |
| GET/PATCH | `/meetings/:meetingId`                                         | `Meeting`, `UpdateMeetingRequest`                                  | Đã triển khai; PATCH yêu cầu Group Admin và required `version`          |
| POST      | `/meetings/:meetingId/cancel`                                  | `CancelMeetingRequest`, `Meeting`                                  | Đã triển khai; yêu cầu Group Admin                                      |
| POST      | `/meetings/:meetingId/google-sync/retry`                       | `GoogleMeetingSyncSummary`                                         | Contract ACCEPTED; chưa implement                                       |
| GET       | `/meetings/:meetingId/minutes`                                 | `MeetingMinutes`                                                   | Active member; trả latest version, chưa có trả `404`                    |
| PUT       | `/meetings/:meetingId/minutes`                                 | `UpdateMeetingMinutesRequest`, `MeetingMinutes`                    | Active Group Admin; optimistic version                                  |
| GET       | `/tasks`                                                       | `Task[]`                                                           | Đã triển khai; trả toàn bộ task có `assigneeId` bằng user từ JWT        |
| POST      | `/tasks`                                                       | `CreateTaskRequest`, `Task`                                        | Group Admin; bắt buộc `Idempotency-Key`                                 |
| PATCH     | `/tasks/:taskId/status`                                        | `UpdateTaskStatusRequest`, `Task`                                  | Assignee hoặc active Group Admin; optimistic version                    |
| GET       | `/dashboard`                                                   | `DashboardResponse`                                                | M3 đã triển khai task summary cá nhân                                   |
| GET       | `/notifications`                                               | `Notification[]`                                                   | M1 đã triển khai                                                        |
| POST      | `/notifications/:notificationId/read`                          | `{read:true}`                                                      | M1 đã triển khai                                                        |
| POST      | `/integrations/google/connect`                                 | Authorization URL                                                  | M4 đã triển khai OAuth connect                                          |
| GET       | `/integrations/google/callback`                                | Google OAuth callback                                              | M4 đã triển khai; public callback có one-time state                     |
| GET       | `/integrations/google/meet-context`                            | `Meeting`                                                          | M4 đã triển khai; xác thực membership từ Meet context                   |
| POST      | `/meetings/:meetingId/google-artifacts/sync`                   | `StartGoogleArtifactSyncRequest/Response`                          | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/attachments/upload-url`                  | `CreateUploadUrlResponse`                                          | M4 đã triển khai                                                        |
| POST      | `/meetings/:meetingId/attachments/:attachmentId/complete`      | `CompleteUploadResponse`                                           | M4 đã triển khai cho tài liệu                                           |
| GET       | `/meetings/:meetingId/attachments`                             | `Attachment[]`                                                     | M4 đã triển khai                                                        |
| POST      | `/attachments/:attachmentId/download-url`                      | `AttachmentDownloadTarget`                                         | M4 đã triển khai                                                        |
| POST      | `/meetings/:meetingId/recordings`                              | `CreateRecordingRequest`, `Recording`                              | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/transcriptions`                          | `StartTranscriptionRequest`, `AIJob`                               | Đã chốt contract mục tiêu; chưa implement                               |
| GET       | `/meetings/:meetingId/transcripts`                             | `Transcript[]`, `TranscriptSegment[]`                              | Đã chốt contract mục tiêu; chưa implement                               |
| PATCH     | `/transcripts/:transcriptId/segments/:segmentId`               | `UpdateTranscriptSegmentRequest`, `TranscriptSegment`              | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/transcripts/:transcriptId/approve`                           | `ApproveTranscriptRequest`, `Transcript`, `AIJob`                  | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/live-transcription`                      | `StartLiveTranscriptionRequest`, `LiveTranscriptionSession`        | Đã chốt contract mục tiêu; chưa implement                               |
| GET       | `/meetings/:meetingId/live-transcription/:sessionId`           | `LiveTranscriptionSession`                                         | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/live-transcription/:sessionId/segments`  | `AppendFinalSegmentsRequest`, `TranscriptSegment[]`                | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/live-transcription/:sessionId/heartbeat` | `LiveTranscriptionHeartbeatRequest`, `LiveTranscriptionSession`    | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/live-transcription/:sessionId/reconnect` | `ReconnectLiveTranscriptionRequest`, `LiveTranscriptionConnection` | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/live-transcription/:sessionId/stop`      | `StopLiveTranscriptionRequest`, `LiveTranscriptionSession`         | Đã chốt contract mục tiêu; chưa implement                               |
| POST      | `/meetings/:meetingId/ai/chat`                                 | `MeetingChatRequest` → `AIJob` (`202`)                             | Phase 4A handler/application đã implement                               |
| POST      | `/groups/:groupId/ai/search`                                   | `GroupKnowledgeQuery` → `AIJob` (`202`)                            | Phase 4A handler/application đã implement                               |
| POST      | `/meetings/:meetingId/ai/minutes-draft`                        | `GenerateMeetingDraftRequest` → `AIJob` (`202`)                    | Phase 4A handler/application đã implement                               |
| POST      | `/meetings/:meetingId/ai/task-proposals`                       | `GenerateMeetingDraftRequest` → `AIJob` (`202`)                    | Phase 4A handler/application đã implement                               |
| POST      | `/ai/task-proposals/:proposalId/confirm`                       | `ConfirmTaskProposalRequest/Response`                              | Group Admin theo FR-16; chưa implement                                  |
| POST      | `/groups/:groupId/ai/progress-analysis`                        | `GroupProgressAnalysisRequest` → `AIJob` (`202`)                   | Phase 4A; yêu cầu Group Admin                                           |
| POST      | `/groups/:groupId/ai/tool-proposals`                           | `CreateToolProposalRequest`, `ToolProposal`                        | Pha AI mở rộng; chưa implement                                          |
| POST      | `/ai/tool-proposals/:id/confirm`                               | `ConfirmToolProposalRequest/Response`                              | Pha AI mở rộng; chưa implement                                          |
| GET       | `/ai/jobs/:aiJobId`                                            | `AIJobDetail`                                                      | M5 đã triển khai                                                        |

## Contract đồng bộ Google của Meeting

Decision 4A runtime đã **ACCEPTED** ngày 2026-08-07; runtime và AWS chưa hoàn tất. Meeting create, update và cancel thành công khi transaction nội bộ đã ghi đồng thời Meeting và synchronization intent. Các response này không chờ Google; Google failure sau đó không biến mutation nội bộ đã thành công thành `5xx` hoặc rollback Meeting.

Meeting detail mục tiêu bổ sung summary chỉ đọc, tách khỏi lifecycle:

```json
{
  googleSync: {
    provider: GOOGLE,
    status: PENDING|SYNCED|FAILED|ACTION_REQUIRED,
    meetUrl: https://meet.google.com/...,
    failureCode: GOOGLE_CONNECTION_REQUIRED,
    nextRetryAt: 2026-08-07T10:00:00.000Z
  }
}
```

`meetUrl`, `failureCode` và `nextRetryAt` là optional và chỉ xuất hiện khi phù hợp. API chỉ trả `meetUrl` từ trusted Google state. Không expose raw provider error, `googleEventId`, OAuth credential, `syncRevision` hoặc `attemptCount`. Create/update body không nhận bất kỳ trusted integration field nào.

### `POST /meetings/:meetingId/google-sync/retry`

- Authentication: Cognito JWT.
- Authorization: actor là active member và `GROUP_ADMIN` của group được resolve server-side từ Meeting; không tin `groupId` trong body.
- Request body: không chứa Meeting snapshot hoặc integration fields; body rỗng được chấp nhận theo parser contract mà implementation PR chốt.
- Behavior: đọc Meeting và sync record hiện tại; không đổi Meeting lifecycle; tạo revision mới ở `PENDING`, reset attempt/failure metadata, rồi xử lý bất đồng bộ.
- Success: `200` theo envelope hiện tại, `data` là read-only `GoogleMeetingSyncSummary` ở `PENDING`. Response xác nhận intent đã durable, không xác nhận Google đã đồng bộ.
- `400`: malformed input; `401`: thiếu/sai authentication; `403`: không phải active Group Admin; `404`: Meeting hoặc sync resource không tồn tại theo access boundary; `409`: conditional revision conflict hoặc trạng thái không thể tạo retry an toàn; `5xx`: chỉ khi không thể persist retry intent/internal dependency lỗi, không dùng để biểu diễn Google attempt bất đồng bộ thất bại.

Chi tiết state machine, retry 1m/5m/15m/1h/6h, idempotency và failure classification nằm tại [M2–M4 synchronization runtime contract](decisions/m2-m4-synchronization.md).

## Quy ước contract cho AI và artifact

- API nghiệp vụ không nhận binary audio/tài liệu. API chỉ cấp presigned URL; Browser upload trực tiếp vào S3 user-content và gọi complete với checksum.
- Mỗi meeting nhận tối đa 10 file. Mỗi file tối đa 50 MB; tài liệu hỗ trợ TXT/Markdown/CSV/TSV/JSON/NDJSON/HTML/XHTML/XML/YAML/iCalendar, PDF, DOCX/PPTX/XLSX và ODT/ODP/ODS; audio hỗ trợ MP3/WAV/WebM/M4A và audio tối đa 60 phút. Complete handler phải kiểm tra lại size/checksum bằng `HeadObject`; worker tiếp tục kiểm tra extension, MIME và signature/cấu trúc file khi áp dụng trước khi chuyển attachment sang `READY`.
- Parse, STT, ingestion và generation trả `202 Accepted` cùng `aiJobId`. Client theo dõi bằng `GET /ai/jobs/:id`; không giữ request mở chờ file dài. Endpoint polling trả `AIJobDetail` gồm metadata job và `result` tùy chọn đã được kiểm tra bằng schema runtime. Khi job M5 ở trạng thái `COMPLETED`, `result` là bắt buộc và phải khớp `type`: `GENERATE_ANSWER` → `GroundedAnswer`, `GENERATE_MINUTES` → `MinutesDraft`, `GENERATE_TASK_PROPOSALS` → `TaskProposal[]`, `PROGRESS_ANALYSIS` → `GroupProgressAnalysis`, `INGEST_SOURCE` → kết quả ingestion. Record sai contract không được trả nguyên trạng cho client.
- `MeetingChatRequest` gồm `question`, `conversationId?` và `intent=QUESTION_ANSWER|LATE_JOIN_SUMMARY`; `meetingId` lấy từ path. Current-meeting chat dùng tài liệu `READY`, approved sources và các live segment final đọc trực tiếp từ transcript repository, không chờ Knowledge Base ingestion. Citation live transcript phải ghi `Speaker N`, timestamp và trạng thái chưa duyệt.
- `GroupKnowledgeQuery` gồm `question`, `scope=SELECTED_MEETINGS|WHOLE_GROUP`, `meetingIds?` và `conversationId?`. `SELECTED_MEETINGS` bắt buộc có danh sách; `WHOLE_GROUP` không nhận meeting ngoài path group. Backend kiểm tra mọi meeting thuộc cùng `groupId` rồi áp filter group/meeting-set/ACL trước retrieval.
- `GroundedAnswer` gồm `answer`, `citations[]`, `scope` và `insufficientContext`. Citation ánh xạ về group/meeting/source/segment nội bộ, không lộ raw S3 key hoặc presigned URL. Khi thiếu nguồn, API trả `insufficientContext=true`.
- `GenerateMinutesAndTaskProposalsResponse` gồm minutes draft, quyết định/action item đã được nêu và `TaskProposal[]`; mỗi mục có citation. Assignee/deadline/priority không được model tự điền nếu transcript không nêu rõ.
- `TaskProposal` có `status=PENDING|CONFIRMED|EXECUTED|REJECTED|EXPIRED|FAILED`, `meetingId`, title/description, `assigneeId?`, `priority?`, `dueAt?`, `missingFields[]` và transcript citations. Trước confirm, `title`, `assigneeId` và `priority` phải hợp lệ theo `CreateTaskRequest`; `dueAt` vẫn tùy chọn. Confirm kiểm tra lại quyền/idempotency rồi gọi Task API chuẩn một lần.
- `GroupProgressAnalysisResponse` chỉ diễn giải `GroupProgressSnapshot` do backend tính từ task/meeting trong path group; không trả điểm/xếp hạng/suy diễn thái độ cá nhân và không gây mutation.
- `TranscriptSegment` giữ `startMs`, `endMs`, `text`, `confidence`, `languageCode`, `speakerLabel` dạng `Speaker N`, `version` và audit metadata; không có `speakerUserId`.
- `LiveTranscriptionSession` giữ `meetingId`, nguồn capture, consent reference, trạng thái `STARTING|ACTIVE|RECONNECTING|STOPPED|FAILED`, sequence cuối đã xác nhận và heartbeat; thông tin kết nối streaming phải ngắn hạn.
- Endpoint segment chỉ nhận final result có giới hạn kích thước cùng `ResultId/sequence`; gửi lại cùng khóa không tạo segment trùng. Partial result chỉ hiển thị ở client và không được lưu/index.
- Heartbeat quá hạn chuyển session sang `FAILED`. Reconnect phải kiểm tra lại quyền, cấp kết nối Amazon Transcribe mới có thời hạn ngắn và tiếp tục từ sequence cuối đã xác nhận; khoảng audio thiếu được ghi nhận, không được tự suy đoán.
- Voice record/live transcript là nguồn duy nhất của nội dung phát biểu và phải chạy nền trong mọi phiên họp sau consent/cấp quyền. Khi session chưa `ACTIVE` hoặc chuyển `FAILED`, API biên bản/task proposal và các chức năng phụ thuộc nội dung phải trả trạng thái chưa đủ dữ liệu; không suy đoán từ agenda hoặc participant metadata.
- `StartLiveTranscriptionRequest` chỉ nhận `languageCode`; frontend mặc định `vi-VN`, backend kiểm tra allowlist Amazon Transcribe theo môi trường. MVP không có `AUTO`, không tự dịch và không dùng Deepgram.
- `speakerLabel` chỉ dùng để phân biệt `Speaker 1/2/...` trong session; PATCH có thể sửa label nhưng không ánh xạ danh tính.
- Approve transcript yêu cầu Organizer hoặc Group Admin, `expectedVersion`, audit metadata và `Idempotency-Key`. Duyệt version cũ trả `409`; retry không tạo AIJob hoặc KnowledgeSource trùng.
- Group RAG chỉ ingest file `READY`, approved transcript và approved minutes. Current-meeting chat có thể đọc final live segment trực tiếp nhưng phải đánh dấu nguồn chưa duyệt; selected/whole-group retrieval luôn yêu cầu `approved=true`.
- `ToolProposal` có `status=PENDING|CONFIRMED|EXECUTED|REJECTED|EXPIRED|FAILED`, input chuẩn hóa và expiry. Tạo proposal không gây mutation.
- Confirm phải kiểm tra lại JWT, membership/role, schema, policy và idempotency ngay tại thời điểm thực thi; không tin kết quả kiểm tra cũ.
- Nội dung tài liệu/transcript không được biến thành tool instruction. Tool name phải thuộc server-side allowlist, không nhận tên hàm tùy ý từ model.
- Google artifact sync lưu trạng thái `POLLING|AVAILABLE|UNAVAILABLE|ACTION_REQUIRED|FAILED`; `UNAVAILABLE` là kết quả hợp lệ và phải dẫn tới fallback upload/capture.

## Response format hiện có

`GET /tasks` không nhận `userId` từ query, path hoặc body. Backend chỉ dùng `sub` từ JWT và tự đọc hết các trang DynamoDB qua GSI2. API chưa expose pagination trong MVP hiện tại; `limit`/`cursor` sẽ dùng cursor contract chung sau khi contract list endpoint được chốt.

`POST /tasks` yêu cầu active Group Admin, lấy `createdBy` từ JWT, kiểm tra assignee là active member cùng group và kiểm tra `sourceMeetingId` thuộc group khi có. Retry cùng actor/key/payload trả task cũ; dùng cùng key với payload khác trả `409`.

`PATCH /tasks/:taskId/status` nhận `{ status, expectedVersion }` và chỉ cho assignee hoặc active Group Admin của task cập nhật. API dùng `TODO|DOING|DONE`, cho phép `TODO→DOING|DONE`, `DOING→TODO|DONE`, `DONE→DOING`; `DONE→TODO` trả `422`. Same-status trả task hiện tại nhưng vẫn kiểm tra version, không tăng version và không ghi history. Task legacy thiếu `version` được xem là version `0`. Version cũ trả `409`; PATCH này không yêu cầu `Idempotency-Key`.

`GET /meetings/:meetingId/minutes` lấy meeting từ path, kiểm tra actor là active member của `meeting.groupId` rồi trả immutable Minutes version mới nhất; meeting hoặc Minutes chưa tồn tại trả `404`. `PUT` chỉ cho active Group Admin, không nhận meeting/group/actor hoặc metadata server-managed từ body và từ chối meeting `CANCELLED` bằng `422`. Request gồm `summary`, `discussion`, `decisions`, `actionItems` và `expectedVersion`; mỗi action item nhận `id?`, `content`, `assigneeId?`, `dueAt?`, trong đó `dueAt` phải là ISO datetime có timezone. ID có trong request phải thuộc latest Minutes và không được lặp; ID lạ hoặc trùng trả `422`, còn item mới không có ID được server sinh UUID. `taskId` là metadata server-managed, client gửi sẽ trả `400`; liên kết này được giữ khi action item vẫn xuất hiện trong version mới. Assignee nếu có phải là active member cùng group. Chưa có Minutes dùng `expectedVersion=0` để tạo version `1`; version cũ trả `409`. PUT không dùng `Idempotency-Key`; retry sau success với expected version cũ trả `409` và không tạo phiên bản trùng.

`GET /dashboard` trả task summary cá nhân của user đã xác thực. User scope chỉ lấy từ JWT `sub`; endpoint không nhận `userId` từ path, query hoặc body. Backend đọc toàn bộ task được giao qua access pattern GSI2 hiện có và chấp nhận eventual consistency ngắn của GSI.

```ts
interface DashboardTaskSummary {
  total: number;
  todo: number;
  doing: number;
  done: number;
  overdue: number;
}

interface DashboardResponse {
  generatedAt: ISODateTime;
  tasks: DashboardTaskSummary;
}
```

`generatedAt` là UTC ISO datetime do server tạo. `total = todo + doing + done`. Task chỉ được tính quá hạn khi có `dueAt < generatedAt` và status khác `DONE`; task không có `dueAt` hoặc có `dueAt === generatedAt` không quá hạn. Endpoint không trả raw Task và chưa bao gồm meeting, group, notification hoặc progress snapshot.

Health response:

```json
{
  "success": true,
  "data": {
    "service": "campusmeet-api",
    "status": "ok",
    "timestamp": "2026-07-06T00:00:00.000Z"
  },
  "requestId": "request-id"
}
```

Nghiệp vụ khác chưa triển khai:

```json
{
  "success": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Chức năng này chưa được triển khai."
  },
  "requestId": "request-id"
}
```

## Quy trình thay đổi contract

1. Sửa DTO/type trong `packages/shared/src`.
2. Cập nhật handler/application/backend adapter liên quan.
3. Cập nhật frontend service/query liên quan.
4. Cập nhật bảng contract này.
5. Thêm hoặc sửa test trước khi merge.

## Quyết định đã khóa và điểm còn phải triển khai

| Nội dung       | Quyết định/việc triển khai                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nested routes  | Bổ sung router path-template dùng chung; không viết router riêng cho từng chức năng                                                                                                                                           |
| Resource IDs   | Chốt dùng path parameter hay query parameter nhất quán cho group/meeting/task                                                                                                                                                 |
| Validation     | Dùng Zod cho input API và output AI Worker; lỗi validation theo response envelope hiện hành                                                                                                                                   |
| Authentication | Chốt Cognito JWT authorizer và claims Lambda tin cậy                                                                                                                                                                          |
| Authorization  | Chốt helper membership/admin dùng chung theo `groupId`                                                                                                                                                                        |
| Idempotency    | Mọi mutation bất đồng bộ nhận `Idempotency-Key`; lưu record theo actor + operation + resource                                                                                                                                 |
| Pagination     | Chốt cursor format cho list endpoints                                                                                                                                                                                         |
| Upload policy  | 10 file/meeting, 50 MB/file; TXT/Markdown/CSV/TSV/JSON/NDJSON/HTML/XHTML/XML/YAML/iCalendar, PDF, DOCX/PPTX/XLSX, ODT/ODP/ODS và MP3/WAV/WebM/M4A; audio tối đa 60 phút; checksum + signature/cấu trúc validation khi áp dụng |
| Consent        | Organizer hoặc Group Admin được start recording/live STT sau consent; raw audio giữ 7 ngày và cho phép xóa sớm theo quyền                                                                                                     |
| STT provider   | Chỉ Amazon Transcribe trong MVP; `languageCode` explicit, frontend mặc định `vi-VN`, không `AUTO` hoặc Deepgram                                                                                                               |
| AI job         | Chốt state transition, timeout, retry, DLQ/failure handling và token/phút/cost metadata                                                                                                                                       |
| Grounding      | Chốt citation schema cho tài liệu/transcript/biên bản; current/selected/whole-group scope và filter `groupId`/meeting-set/ACL                                                                                                 |
| Task proposal  | Chốt mapping ActionItem/Task DTO, missing fields, quyền confirm và liên kết citation nguồn                                                                                                                                    |
| Group progress | Chốt `GroupProgressSnapshot` do M3 cung cấp; AI chỉ diễn giải dữ liệu cấp nhóm                                                                                                                                                |
| Tool allowlist | Chốt tool MVP, quyền, trường cần xác nhận, expiry và audit; không expose CRUD tùy ý cho model                                                                                                                                 |
| Retention      | Upload chưa hoàn tất 1 ngày, raw audio 7 ngày, AIJob/conversation 30 ngày; source/vector tồn tại đến khi source hoặc meeting bị xóa                                                                                           |
| Shared states  | Tách `MeetingStatus` khỏi `GoogleSyncStatus`; cập nhật `@campusmeet/shared` trước khi implement route mới                                                                                                                     |
| Google sync    | Runtime design 4A đã ACCEPTED; implement sync record/transaction, Stream worker, Scheduler retry, manual retry và read-only detail summary; runtime/AWS chưa complete                                                         |

Không triển khai route hoặc CRUD thật chỉ để làm bảng này trông hoàn chỉnh.

## Accepted M2 contract implementation (2026-08-06)

For Meeting creation, the authenticated creator is the organizer; `organizerId` is server-managed and cannot be supplied or reassigned by clients. Every `PATCH /meetings/{meetingId}` request requires a positive integer `version`; missing/malformed versions return the standard `400 BAD_REQUEST` envelope and stale versions return `409 CONFLICT`.

`GET /groups/{groupId}/meetings` returns `CursorPage<Meeting>` in the success envelope. Query `limit` defaults to 20 and must be an integer from 1 through 100. `cursor` is an opaque, versioned logical cursor scoped to the group and stable `startsAt + meetingId` ordering; malformed or wrong-group cursors return `400`. `nextCursor` is omitted at the end. Clients must not decode the cursor.

Google synchronization follows eventual consistency: an external failure does not roll back the internal Meeting. The complete runtime design is ACCEPTED in `docs/decisions/m2-m4-synchronization.md`. Latest main has OAuth and Calendar create code, but sync-record persistence, Stream worker, `syncRevision`, update/cancel reconciliation and bounded retry remain unimplemented and are not AWS-runtime verified.
