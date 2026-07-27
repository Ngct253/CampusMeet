# Hợp đồng API CampusMeet

## Trạng thái chung

`GET /health` đã có handler trả `200`. Các handler nghiệp vụ hiện chỉ parse JSON ở mức skeleton và trả `501 Not Implemented`; chưa có authentication, authorization, validation schema, application service hoặc database call.

Request/response types phải import từ `@campusmeet/shared`, không copy interface giữa frontend và backend.

| Method                | Endpoint dự kiến               | Shared contract                                                        | Trạng thái hiện tại                            |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------- |
| GET                   | `/health`                      | `ApiSuccessResponse<{service,status,timestamp}>`                       | Đã có health handler                           |
| GET/POST              | `/groups`                      | `CreateGroupRequest`, `Group`                                          | Handler skeleton, trả 501                      |
| POST                  | `/groups/:groupId/invitations` | `CreateInvitationRequest`                                              | Dự kiến, chưa có route riêng                   |
| GET/PATCH             | `/memberships`                 | `Membership`, invitation DTO                                           | Handler skeleton chung, trả 501                |
| GET/POST/PATCH/DELETE | `/meetings`                    | `CreateMeetingRequest`, `UpdateMeetingRequest`, `CancelMeetingRequest` | Handler skeleton, trả 501                      |
| GET/POST              | `/minutes`                     | `CreateMinutesRequest`, `MeetingMinutes`                               | Handler skeleton, trả 501                      |
| GET/POST/PATCH        | `/tasks`                       | `CreateTaskRequest`, `UpdateTaskStatusRequest`                         | Handler skeleton, trả 501                      |
| GET                   | `/dashboard`                   | `DashboardResponse`                                                    | Handler skeleton, trả 501                      |
| GET/PATCH             | `/notifications`               | `Notification[]`                                                       | Handler skeleton, trả 501                      |
| POST/DELETE           | `/integrations/google`         | Chưa chốt DTO                                                          | Dự kiến; skeleton hiện chỉ bắt `/integrations` |
| POST                  | `/meetings/:meetingId/google-artifacts/sync` | `StartGoogleArtifactSyncRequest/Response`                | Đã chốt contract mục tiêu; chưa implement      |
| POST/GET              | `/meetings/:meetingId/attachments` | `CreateUploadUrlRequest`, `Attachment`, `CompleteUploadRequest`     | Đã chốt contract mục tiêu; chưa implement      |
| POST/GET              | `/meetings/:meetingId/recordings` | `CreateRecordingRequest`, `Recording`                               | Đã chốt contract mục tiêu; chưa implement      |
| POST/GET/PATCH        | `/meetings/:meetingId/transcripts` | `StartTranscriptionRequest`, `Transcript`, `TranscriptSegment`      | Đã chốt contract mục tiêu; chưa implement      |
| POST                  | `/meetings/:meetingId/ai/chat` | `MeetingChatRequest`, `GroundedAnswer`                                  | Đã chốt contract mục tiêu; chưa implement      |
| POST                  | `/meetings/:meetingId/ai/minutes-draft` | `GenerateMinutesDraftRequest/Response`                         | Đã chốt contract mục tiêu; chưa implement      |
| POST                  | `/groups/:groupId/ai/search`   | `GroupKnowledgeQuery`, `GroundedAnswer`                                  | Pha AI mở rộng; chưa implement                 |
| POST                  | `/groups/:groupId/ai/tool-proposals` | `CreateToolProposalRequest`, `ToolProposal`                         | Pha AI mở rộng; chưa implement                 |
| POST                  | `/ai/tool-proposals/:id/confirm` | `ConfirmToolProposalRequest/Response`                                 | Pha AI mở rộng; chưa implement                 |
| GET                   | `/ai/jobs/:aiJobId`            | `AIJob`                                                                  | Đã chốt contract mục tiêu; chưa implement      |

## Quy ước contract cho AI và artifact

- API nghiệp vụ không nhận binary audio/tài liệu. API chỉ cấp presigned URL; Browser upload trực tiếp vào S3 user-content và gọi complete với checksum.
- Parse, STT, ingestion và generation trả `202 Accepted` cùng `aiJobId`. Client theo dõi bằng `GET /ai/jobs/:id`; không giữ request mở chờ file dài.
- `GroundedAnswer` gồm `answer`, `citations[]`, `scope` và `insufficientContext`. Khẳng định nội bộ không có citation phải bị từ chối hoặc đánh dấu không đủ căn cứ.
- `TranscriptSegment` giữ `startMs`, `endMs`, `text`, `confidence`, `speakerLabel`, `speakerUserId?`, `version` và audit metadata.
- `speakerLabel` do STT sinh là ẩn danh; chỉ PATCH của người có quyền mới ánh xạ sang `speakerUserId`.
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

| Nội dung       | Hiện trạng cần chốt                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Nested routes  | Router skeleton chỉ dispatch exact path; invitation và Google nested path mới là contract dự kiến |
| Resource IDs   | Chốt dùng path parameter hay query parameter nhất quán cho group/meeting/task                     |
| Validation     | Chốt thư viện/schema và error details trước khi thêm CRUD                                         |
| Authentication | Chốt Cognito JWT authorizer và claims Lambda tin cậy                                              |
| Authorization  | Chốt helper membership/admin dùng chung theo `groupId`                                            |
| Idempotency    | Chốt header/key và storage cho meeting, Google event và reminder                                  |
| Pagination     | Chốt cursor format cho list endpoints                                                             |
| Upload policy  | Chốt allowlist MIME/đuôi, giới hạn size, checksum, scan/quarantine và S3 lifecycle                 |
| Consent        | Chốt nội dung consent, nguồn capture, retention/xóa và ai được record/nghe/sửa                     |
| STT benchmark  | So sánh Amazon Transcribe `vi-VN` và Deepgram trên tập audio nhóm; chọn provider mặc định          |
| AI job         | Chốt state transition, timeout, retry, DLQ/failure handling và token/phút/cost metadata            |
| Grounding      | Chốt citation schema và quy tắc `insufficientContext`; filter `groupId`/ACL trước retrieval        |
| Tool allowlist | Chốt tool MVP, quyền, trường cần xác nhận, expiry và audit; không expose CRUD tùy ý cho model       |
| Retention      | Chốt thời hạn audio/transcript/conversation/vector và quy trình xóa xuyên S3/DynamoDB/Knowledge Base |
| Shared states  | Tách `MeetingStatus` khỏi `GoogleSyncStatus`; cập nhật `@campusmeet/shared` trước khi implement route mới |

Không triển khai route hoặc CRUD thật chỉ để làm bảng này trông hoàn chỉnh.
