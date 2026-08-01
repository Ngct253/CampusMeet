# Hợp đồng API CampusMeet

## Trạng thái chung

`GET /health` đã có handler trả `200`. Các handler nghiệp vụ hiện chỉ parse JSON ở mức skeleton và trả `501 Not Implemented`; chưa có authentication, authorization, validation schema, application service hoặc database call.

Request/response types phải import từ `@campusmeet/shared`, không copy interface giữa frontend và backend.

CampusMeet web và CampusMeet Meet Add-on là hai client surface của cùng hệ thống. Add-on side panel dùng lại các endpoint bên dưới, không có API đặc quyền hoặc database riêng. `meetingId`/`meetingCode` lấy từ Meet Add-ons SDK chỉ là context để ánh xạ; backend vẫn phải xác thực JWT, tìm meeting nội bộ và kiểm tra membership/role trước khi trả dữ liệu hoặc mutation.

| Method                | Endpoint dự kiến                                              | Shared contract                                                        | Trạng thái hiện tại                            |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| GET                   | `/health`                                                     | `ApiSuccessResponse<{service,status,timestamp}>`                       | Đã có health handler                           |
| GET/POST              | `/groups`                                                     | `CreateGroupRequest`, `Group`                                          | Handler skeleton, trả 501                      |
| POST                  | `/groups/:groupId/invitations`                                | `CreateInvitationRequest`                                              | Dự kiến, chưa có route riêng                   |
| GET/PATCH             | `/memberships`                                                | `Membership`, invitation DTO                                           | Handler skeleton chung, trả 501                |
| GET/POST/PATCH/DELETE | `/meetings`                                                   | `CreateMeetingRequest`, `UpdateMeetingRequest`, `CancelMeetingRequest` | Handler skeleton, trả 501                      |
| GET/POST              | `/minutes`                                                    | `CreateMinutesRequest`, `MeetingMinutes`                               | Handler skeleton, trả 501                      |
| GET/POST/PATCH        | `/tasks`                                                      | `CreateTaskRequest`, `UpdateTaskStatusRequest`                         | Handler skeleton, trả 501                      |
| GET                   | `/dashboard`                                                  | `DashboardResponse`                                                    | Handler skeleton, trả 501                      |
| GET/PATCH             | `/notifications`                                              | `Notification[]`                                                       | Handler skeleton, trả 501                      |
| POST/DELETE           | `/integrations/google`                                        | Chưa chốt DTO                                                          | Dự kiến; skeleton hiện chỉ bắt `/integrations` |
| POST                  | `/meetings/:meetingId/google-artifacts/sync`                  | `StartGoogleArtifactSyncRequest/Response`                              | Đã chốt contract mục tiêu; chưa implement      |
| POST/GET              | `/meetings/:meetingId/attachments`                            | `CreateUploadUrlRequest`, `Attachment`, `CompleteUploadRequest`        | Đã chốt contract mục tiêu; chưa implement      |
| POST/GET              | `/meetings/:meetingId/recordings`                             | `CreateRecordingRequest`, `Recording`                                  | Đã chốt contract mục tiêu; chưa implement      |
| POST/GET/PATCH        | `/meetings/:meetingId/transcripts`                            | `StartTranscriptionRequest`, `Transcript`, `TranscriptSegment`         | Đã chốt contract mục tiêu; chưa implement      |
| POST                  | `/meetings/:meetingId/live-transcription`                     | `StartLiveTranscriptionRequest`, `LiveTranscriptionSession`            | Đã chốt contract mục tiêu; chưa implement      |
| GET                   | `/meetings/:meetingId/live-transcription/:sessionId`          | `LiveTranscriptionSession`                                             | Đã chốt contract mục tiêu; chưa implement      |
| POST                  | `/meetings/:meetingId/live-transcription/:sessionId/segments` | `AppendFinalSegmentsRequest`, `TranscriptSegment[]`                    | Đã chốt contract mục tiêu; chưa implement      |
| POST                  | `/meetings/:meetingId/live-transcription/:sessionId/stop`     | `StopLiveTranscriptionRequest`, `LiveTranscriptionSession`             | Đã chốt contract mục tiêu; chưa implement      |
| POST                  | `/meetings/:meetingId/ai/chat`                                | `MeetingChatRequest`, `GroundedAnswer`                                 | Bắt buộc; chưa implement                       |
| POST                  | `/groups/:groupId/ai/search`                                  | `GroupKnowledgeQuery`, `GroundedAnswer`                                | Bắt buộc; chưa implement                       |
| POST                  | `/meetings/:meetingId/ai/minutes-draft`                       | `GenerateMinutesAndTaskProposalsRequest/Response`                      | Bắt buộc; chưa implement                       |
| POST                  | `/meetings/:meetingId/ai/task-proposals`                      | `GenerateTaskProposalsRequest`, `TaskProposal[]`                       | Thành viên meeting; chưa implement             |
| POST                  | `/ai/task-proposals/:id/confirm`                              | `ConfirmTaskProposalRequest/Response`                                  | Group Admin theo FR-16; chưa implement         |
| POST                  | `/groups/:groupId/ai/progress-analysis`                       | `GroupProgressAnalysisRequest/Response`                                | Group Admin; chưa implement                    |
| POST                  | `/groups/:groupId/ai/tool-proposals`                          | `CreateToolProposalRequest`, `ToolProposal`                            | Pha AI mở rộng; chưa implement                 |
| POST                  | `/ai/tool-proposals/:id/confirm`                              | `ConfirmToolProposalRequest/Response`                                  | Pha AI mở rộng; chưa implement                 |
| GET                   | `/ai/jobs/:aiJobId`                                           | `AIJob`                                                                | Đã chốt contract mục tiêu; chưa implement      |

## Quy ước contract cho AI và artifact

- API nghiệp vụ không nhận binary audio/tài liệu. API chỉ cấp presigned URL; Browser upload trực tiếp vào S3 user-content và gọi complete với checksum.
- Parse, STT, ingestion và generation trả `202 Accepted` cùng `aiJobId`. Client theo dõi bằng `GET /ai/jobs/:id`; không giữ request mở chờ file dài.
- `MeetingChatRequest` gồm `query` và `conversationId?`; `meetingId` lấy từ path. Current-meeting chat dùng tài liệu `READY`, approved sources và các live segment final đọc trực tiếp từ transcript repository, không chờ Knowledge Base ingestion. Citation live transcript phải ghi `Speaker N`, timestamp và trạng thái chưa duyệt.
- `GroupKnowledgeQuery` gồm `query`, `scope=SELECTED_MEETINGS|WHOLE_GROUP`, `meetingIds?` và `conversationId?`. `SELECTED_MEETINGS` bắt buộc có danh sách; `WHOLE_GROUP` không nhận meeting ngoài path group. Backend kiểm tra mọi meeting thuộc cùng `groupId` rồi áp filter group/meeting-set/ACL trước retrieval.
- `GroundedAnswer` gồm `answer`, `citations[]`, `scope` và `insufficientContext`. Citation ánh xạ về group/meeting/source/segment nội bộ, không lộ raw S3 key hoặc presigned URL. Khi thiếu nguồn, API trả `insufficientContext=true`.
- `GenerateMinutesAndTaskProposalsResponse` gồm minutes draft, quyết định/action item đã được nêu và `TaskProposal[]`; mỗi mục có citation. Assignee/deadline/priority không được model tự điền nếu transcript không nêu rõ.
- `TaskProposal` có `status=PENDING|CONFIRMED|EXECUTED|REJECTED|EXPIRED|FAILED`, `meetingId`, title/description, `assigneeId?`, `priority?`, `dueAt?`, `missingFields[]` và transcript citations. Trước confirm, `title`, `assigneeId` và `priority` phải hợp lệ theo `CreateTaskRequest`; `dueAt` vẫn tùy chọn. Confirm kiểm tra lại quyền/idempotency rồi gọi Task API chuẩn một lần.
- `GroupProgressAnalysisResponse` chỉ diễn giải `GroupProgressSnapshot` do backend tính từ task/meeting trong path group; không trả điểm/xếp hạng/suy diễn thái độ cá nhân và không gây mutation.
- `TranscriptSegment` giữ `startMs`, `endMs`, `text`, `confidence`, `languageCode`, `speakerLabel` dạng `Speaker N`, `version` và audit metadata; không có `speakerUserId`.
- `LiveTranscriptionSession` giữ `meetingId`, nguồn capture, consent reference, trạng thái `STARTING|ACTIVE|RECONNECTING|STOPPED|FAILED`, sequence cuối đã xác nhận và heartbeat; thông tin kết nối streaming phải ngắn hạn.
- Endpoint segment chỉ nhận final result có giới hạn kích thước cùng `ResultId/sequence`; gửi lại cùng khóa không tạo segment trùng. Partial result chỉ hiển thị ở client và không được lưu/index.
- Voice record/live transcript là nguồn duy nhất của nội dung phát biểu và phải chạy nền trong mọi phiên họp sau consent/cấp quyền. Khi session chưa `ACTIVE` hoặc chuyển `FAILED`, API biên bản/task proposal và các chức năng phụ thuộc nội dung phải trả trạng thái chưa đủ dữ liệu; không suy đoán từ agenda hoặc participant metadata.
- `StartLiveTranscriptionRequest` chấp nhận `languageMode=EXPLICIT|AUTO` và `primaryLanguageCode`; transcript giữ ngôn ngữ đang nói, không tự dịch. Tiếng Việt là ngôn ngữ benchmark ưu tiên.
- `speakerLabel` chỉ dùng để phân biệt `Speaker 1/2/...` trong session; PATCH có thể sửa label nhưng không ánh xạ danh tính.
- `ToolProposal` có `status=PENDING|CONFIRMED|EXECUTED|REJECTED|EXPIRED|FAILED`, input chuẩn hóa và expiry. Tạo proposal không gây mutation.
- Confirm phải kiểm tra lại JWT, membership/role, schema, policy và idempotency ngay tại thời điểm thực thi; không tin kết quả kiểm tra cũ.
- Nội dung tài liệu/transcript không được biến thành tool instruction. Tool name phải thuộc server-side allowlist, không nhận tên hàm tùy ý từ model.
- Google artifact sync lưu trạng thái `POLLING|AVAILABLE|UNAVAILABLE|ACTION_REQUIRED|FAILED`; `UNAVAILABLE` là kết quả hợp lệ và phải dẫn tới fallback upload/capture.

## Response format hiện có

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

Nghiệp vụ chưa triển khai:

```json
{
  "success": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Meetings mới chỉ có hợp đồng API."
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

## Điểm cần chốt trước khi implement

| Nội dung       | Hiện trạng cần chốt                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nested routes  | Router skeleton chỉ dispatch exact path; Google, attachment, transcript và AI routes cần một cơ chế path-template chung, không viết router riêng cho từng chức năng |
| Resource IDs   | Chốt dùng path parameter hay query parameter nhất quán cho group/meeting/task                                                                                       |
| Validation     | Chốt thư viện/schema và error details trước khi thêm CRUD                                                                                                           |
| Authentication | Chốt Cognito JWT authorizer và claims Lambda tin cậy                                                                                                                |
| Authorization  | Chốt helper membership/admin dùng chung theo `groupId`                                                                                                              |
| Idempotency    | Chốt header/key và storage cho meeting, Google event và reminder                                                                                                    |
| Pagination     | Chốt cursor format cho list endpoints                                                                                                                               |
| Upload policy  | Chốt allowlist MIME/đuôi, giới hạn size, checksum, scan/quarantine và S3 lifecycle                                                                                  |
| Consent        | Chốt nội dung consent, nguồn capture, retention/xóa và ai được record/nghe/sửa                                                                                      |
| STT benchmark  | So sánh Amazon Transcribe `vi-VN` và Deepgram trên tập audio nhóm; chọn provider mặc định                                                                           |
| AI job         | Chốt state transition, timeout, retry, DLQ/failure handling và token/phút/cost metadata                                                                             |
| Grounding      | Chốt citation schema cho tài liệu/transcript/biên bản; current/selected/whole-group scope và filter `groupId`/meeting-set/ACL                                       |
| Task proposal  | Chốt mapping ActionItem/Task DTO, missing fields, quyền confirm và liên kết citation nguồn                                                                          |
| Group progress | Chốt `GroupProgressSnapshot` do M3 cung cấp; AI chỉ diễn giải dữ liệu cấp nhóm                                                                                      |
| Tool allowlist | Chốt tool MVP, quyền, trường cần xác nhận, expiry và audit; không expose CRUD tùy ý cho model                                                                       |
| Retention      | Chốt thời hạn audio/transcript/conversation/vector và quy trình xóa xuyên S3/DynamoDB/Knowledge Base                                                                |
| Shared states  | Tách `MeetingStatus` khỏi `GoogleSyncStatus`; cập nhật `@campusmeet/shared` trước khi implement route mới                                                           |

Không triển khai route hoặc CRUD thật chỉ để làm bảng này trông hoàn chỉnh.
