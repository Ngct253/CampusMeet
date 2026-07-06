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

Không triển khai route hoặc CRUD thật chỉ để làm bảng này trông hoàn chỉnh.
