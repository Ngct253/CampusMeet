# Hướng dẫn DynamoDB data foundation

## 1. Phạm vi và trạng thái

Data foundation của CampusMeet gồm 17 bảng DynamoDB dùng chung cho môi trường dev.

- AWS account: `604360241374`
- Region: `ap-southeast-1`
- Prefix: `campusmeet-dev`
- Billing mode mục tiêu: `PAY_PER_REQUEST`
- IaC source of truth: `infra/data-foundation.yaml`
- Application stack consumer: `infra/template.yaml`
- Trạng thái application: backend chưa có persistence thật; các repository nghiệp vụ vẫn là skeleton

Ngày 27/07/2026, người quản trị xác nhận 17 bảng cùng prefix đã được tạo trên AWS. Repository không tự coi các bảng đó đã được CloudFormation quản lý cho đến khi verify và import/recreate hoàn tất.

## 2. Inventory 17 bảng

| Bảng | Primary key | Mục đích |
| --- | --- | --- |
| `campusmeet-dev-users` | `userId` | Hồ sơ ứng dụng ánh xạ từ Cognito `sub` |
| `campusmeet-dev-groups` | `groupId` | Nhóm học tập/dự án |
| `campusmeet-dev-memberships` | `groupId` + `userId` | Vai trò và trạng thái thành viên |
| `campusmeet-dev-invitations` | `invitationId` | Lời mời theo token hash và thời hạn |
| `campusmeet-dev-meetings` | `meetingId` | Cuộc họp và trạng thái Google |
| `campusmeet-dev-reminders` | `reminderId` | One-time reminder state |
| `campusmeet-dev-minutes` | `meetingId` | Một biên bản chính cho một cuộc họp |
| `campusmeet-dev-tasks` | `taskId` | Công việc và người phụ trách |
| `campusmeet-dev-notifications` | `notificationId` | Thông báo trong ứng dụng |
| `campusmeet-dev-audit-logs` | `auditId` | Audit an toàn theo nhóm |
| `campusmeet-dev-attachments` | `attachmentId` | Metadata file; nội dung nằm ở S3 |
| `campusmeet-dev-recordings` | `recordingId` | Metadata recording/artifact |
| `campusmeet-dev-recording-consents` | `recordingId` + `userId` | Bằng chứng đồng ý/từ chối |
| `campusmeet-dev-transcripts` | `transcriptId` + `segmentId` | Metadata/segment transcript |
| `campusmeet-dev-ai-jobs` | `aiJobId` | Trạng thái xử lý AI bất đồng bộ |
| `campusmeet-dev-ai-conversations` | `conversationId` + `messageId` | Hội thoại AI và citation refs |
| `campusmeet-dev-tool-proposals` | `proposalId` | Đề xuất tool chờ xác nhận |

Key/index chi tiết nằm trực tiếp trong `infra/data-foundation.yaml`. Thuộc tính ghép như `groupStatus`, `statusCreatedAt`, `versionSort` và `userStatus` phải được backend tạo nhất quán; frontend không tự xây authorization key.

## 3. Ranh giới source of truth

### `infra/data-foundation.yaml`

Sở hữu:

- tên 17 bảng;
- primary key và GSI;
- billing mode;
- SSE;
- TTL cho dữ liệu có thời hạn;
- tham số PITR và deletion protection;
- tags và outputs.

### `infra/template.yaml`

Không tạo DynamoDB table. Stack ứng dụng nhận `DataTablePrefix` và:

- truyền đủ 17 tên bảng vào Lambda environment;
- cấp IAM cho đúng prefix và index;
- giữ Cognito/API/Lambda/Scheduler/SES/hosting/observability ở application stack.

### Backend

Backend chỉ được coi là đã kết nối DynamoDB khi:

1. dùng AWS SDK DocumentClient hoặc adapter tương đương;
2. repository triển khai port domain;
3. identity lấy từ JWT/Cognito, không tin `userId` do frontend gửi;
4. mọi dữ liệu group-scoped kiểm tra membership/role;
5. có test happy path, conditional write và cross-group denial;
6. handler không còn trả `501` cho slice đã triển khai.

## 4. Kiểm tra trạng thái AWS hiện tại

```powershell
.\scripts\verify-data-foundation.ps1 `
  -Profile <aws-profile> `
  -Region ap-southeast-1 `
  -Environment dev
```

Script kiểm tra:

- caller đang ở account `604360241374`;
- đủ 17 bảng;
- trạng thái `ACTIVE`;
- `PAY_PER_REQUEST`;
- primary key;
- danh sách GSI theo template.

Có thể dùng `-SkipSchema` để chỉ kiểm tra inventory/status trong bước điều tra ban đầu:

```powershell
.\scripts\verify-data-foundation.ps1 `
  -Profile <aws-profile> `
  -Region ap-southeast-1 `
  -Environment dev `
  -SkipSchema
```

`-SkipSchema` không phải bằng chứng IaC đã đồng bộ.

## 5. Không deploy trực tiếp lên các bảng đã tồn tại

Lệnh sau chỉ dành cho môi trường chưa có các bảng cùng tên hoặc sau khi kế hoạch import/recreate đã được duyệt:

```powershell
sam validate `
  --template-file infra/data-foundation.yaml `
  --lint `
  --profile <aws-profile> `
  --region ap-southeast-1

sam deploy `
  --template-file infra/data-foundation.yaml `
  --stack-name campusmeet-data-foundation-dev `
  --resolve-s3 `
  --parameter-overrides `
    Environment=dev `
    TablePrefix=campusmeet-dev `
    EnablePointInTimeRecovery=false `
    EnableDeletionProtection=false `
  --no-execute-changeset `
  --profile <aws-profile> `
  --region ap-southeast-1
```

Nếu 17 bảng đã tồn tại, CloudFormation create sẽ thất bại với lỗi resource/table already exists. Không đổi prefix để “né lỗi”, vì application và quyền team đang dùng `campusmeet-dev-*`.

## 6. Hai hướng đưa tài nguyên hiện tại vào IaC

### Hướng A — CloudFormation resource import

Dùng khi bảng hiện tại có key/index tương thích và cần giữ dữ liệu.

1. Chạy script verify.
2. Xuất `describe-table` cho từng bảng và lưu evidence an toàn.
3. So sánh primary key, GSI, TTL, PITR và tags với template.
4. Sửa template hoặc lập migration có chủ đích; không ép import schema sai.
5. Tạo stack/import change set theo quy trình CloudFormation resource import.
6. Review đủ 17 mapping physical table name với logical resource.
7. Execute import.
8. Chạy drift detection và verify lại.
9. Chỉ sau đó đánh dấu CloudFormation là owner.

### Hướng B — Recreate từ IaC

Chỉ dùng khi bảng không có dữ liệu cần giữ hoặc đã export/backup và cả nhóm đồng ý downtime.

1. Xác nhận không có production/user data.
2. Export dữ liệu test cần giữ.
3. Xóa bảng cũ có kiểm soát.
4. Deploy `infra/data-foundation.yaml`.
5. Chạy verify.
6. Nạp lại dữ liệu test.
7. Kiểm tra application slice.

Không xóa bảng chỉ để làm cho template deploy được.

## 7. IAM cho nhóm developer

Group `CampusMeetDevelopers` chỉ cần quyền đọc/ghi item trên `campusmeet-dev-*`. Không cấp quyền thay đổi schema hoặc IAM.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListCampusMeetTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:ListTables",
        "dynamodb:DescribeLimits"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ReadWriteCampusMeetDevTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:ListTagsOfResource",
        "dynamodb:GetItem",
        "dynamodb:BatchGetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-southeast-1:604360241374:table/campusmeet-dev-*",
        "arn:aws:dynamodb:ap-southeast-1:604360241374:table/campusmeet-dev-*/index/*"
      ]
    }
  ]
}
```

`TransactGetItems` và `TransactWriteItems` là tên API, không phải IAM action hợp lệ. Transaction dùng quyền của các thao tác item bên trong; `ConditionCheckItem` phục vụ condition check.

Không cấp:

- `CreateTable`
- `UpdateTable`
- `DeleteTable`
- IAM
- Billing
- quyền ngoài account/Region/prefix dev

## 8. Quy ước dữ liệu

- ID dùng chuỗi ổn định, sinh ở backend.
- Timestamp lưu ISO 8601 UTC; TTL dùng epoch seconds.
- Email/token không đặt trong log; invitation lưu `tokenHash`, không lưu raw token.
- Không tin `groupId`, `userId`, role hoặc assignee chỉ vì frontend gửi.
- Mutation quan trọng dùng conditional expression/idempotency.
- Mọi bản ghi group-scoped mang `groupId`.
- Nội dung file/audio nằm ở S3 private; DynamoDB chỉ lưu metadata/reference.
- Audit log không chứa token, password, transcript/audio thô hoặc prompt nhạy cảm.
- Composite attributes dùng chuẩn:
  - `groupStatus = <groupId>#<status>`
  - `statusCreatedAt = <status>#<createdAt>`
  - `versionSort = <version>#<segmentStart>`
  - `userStatus = <userId>#<status>`

## 9. Vertical slice đầu tiên

Phạm vi đầu tiên phải nhỏ nhưng chạy end-to-end:

1. resolve Cognito identity thành `userId`;
2. `POST /groups`;
3. validate input;
4. tạo record Groups;
5. tạo Memberships với role `GROUP_ADMIN`;
6. dùng transaction/conditional write phù hợp;
7. trả group vừa tạo;
8. `GET /groups` query theo `UserMembershipsIndex`;
9. cross-user/cross-group request bị từ chối;
10. ghi audit record an toàn.

Không triển khai 17 repository cùng lúc. Sau slice group ổn định mới mở rộng invitation, meeting, minutes/task và notification.

## 10. Tiêu chí đồng bộ hoàn tất

- `infra/data-foundation.yaml` validate.
- `infra/template.yaml` không còn định nghĩa bảng placeholder.
- Script verify pass trên account/Region đúng.
- 17 bảng được import/recreate và CloudFormation drift sạch.
- README, architecture và AWS runbook cùng mô tả một trạng thái.
- IAM developer policy không có schema/IAM/billing permissions.
- Có ít nhất một business slice ghi/đọc thật với authorization test.
- Không có secret/account credential trong Git.
