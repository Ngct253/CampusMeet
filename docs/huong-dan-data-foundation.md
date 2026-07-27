# Hướng dẫn DynamoDB data foundation

## 1. Trạng thái và phạm vi

CampusMeet dev hiện dùng:

- AWS account: `604360241374`
- Region: `ap-southeast-1`
- Prefix: `campusmeet-dev`
- Số bảng: `17`
- Billing mục tiêu: `PAY_PER_REQUEST`

Người quản trị đã xác nhận các bảng tồn tại trên AWS. Repository chưa coi CloudFormation là owner cho đến khi schema được kiểm tra và import/recreate hoàn tất.

Backend nghiệp vụ vẫn chưa persistence thật. Việc bảng tồn tại không chứng minh Group/Meeting/Task API đã kết nối database.

## 2. Source of truth

| File | Vai trò |
| --- | --- |
| `infra/data-foundation.spec.json` | Manifest table suffix, logical ID, attributes, primary key, GSI và TTL |
| `scripts/prepare-data-foundation.mjs` | Sinh template CloudFormation an toàn và import map |
| `.aws-sam/data-foundation.generated.json` | Template dùng để validate/import/deploy; không commit |
| `.aws-sam/data-foundation-import.json` | Ánh xạ 17 logical resource với table name; không commit |
| `scripts/verify-data-foundation.ps1` | Kiểm tra read-only trên AWS |
| `infra/template.yaml` | Application stack sử dụng bảng hiện có; không sở hữu bảng |

Không sửa file generated bằng tay. Sửa manifest rồi chạy generator lại.

## 3. Inventory

| Bảng | Primary key | Mục đích |
| --- | --- | --- |
| `campusmeet-dev-users` | `userId` | Hồ sơ ứng dụng/Cognito mapping |
| `campusmeet-dev-groups` | `groupId` | Nhóm |
| `campusmeet-dev-memberships` | `groupId` + `userId` | Membership và role |
| `campusmeet-dev-invitations` | `invitationId` | Invitation/token hash/expiry |
| `campusmeet-dev-meetings` | `meetingId` | Meeting lifecycle và Google state |
| `campusmeet-dev-reminders` | `reminderId` | Reminder state |
| `campusmeet-dev-minutes` | `meetingId` | Một minutes chính cho meeting |
| `campusmeet-dev-tasks` | `taskId` | Task và assignee |
| `campusmeet-dev-notifications` | `notificationId` | In-app notification |
| `campusmeet-dev-audit-logs` | `auditId` | Audit metadata an toàn |
| `campusmeet-dev-attachments` | `attachmentId` | File metadata; binary nằm ở S3 |
| `campusmeet-dev-recordings` | `recordingId` | Recording/artifact metadata |
| `campusmeet-dev-recording-consents` | `recordingId` + `userId` | Consent record |
| `campusmeet-dev-transcripts` | `transcriptId` + `segmentId` | Transcript segment/version |
| `campusmeet-dev-ai-jobs` | `aiJobId` | Async AI job |
| `campusmeet-dev-ai-conversations` | `conversationId` + `messageId` | AI conversation/citation refs |
| `campusmeet-dev-tool-proposals` | `proposalId` | Proposal chờ xác nhận |

GSI chi tiết nằm trong manifest và được CI kiểm tra sau khi generate.

## 4. Sinh template/import map

```powershell
npm run infra:prepare:data
```

Generator tạo:

```text
.aws-sam/data-foundation.generated.json
.aws-sam/data-foundation-import.json
```

Template generated bổ sung tự động:

- `DeletionPolicy: Retain`
- `UpdateReplacePolicy: Retain`
- dependency tuần tự giữa các bảng
- SSE
- `PAY_PER_REQUEST`
- tham số PITR/deletion protection
- tags và outputs

Dependency tuần tự là bắt buộc vì CloudFormation thường tạo resource song song, trong khi DynamoDB giới hạn việc tạo đồng thời nhiều bảng có secondary index.

## 5. Kiểm tra tĩnh

```powershell
npm run infra:check
npm run sam:validate:data
```

`infra:check` xác minh:

- manifest có đúng 17 bảng;
- không trùng suffix/logical ID;
- mọi key attribute được định nghĩa và không có attribute key thừa;
- generated template giữ đúng key/GSI;
- `Retain` và dependency chain tồn tại;
- import map đủ 17 entry;
- application stack không tạo DynamoDB table;
- application stack có đủ 17 biến môi trường;
- không dùng IAM action không tồn tại;
- tài liệu không còn trạng thái AWS cũ.

## 6. Kiểm tra AWS read-only

```powershell
npm run aws:verify:data -- -Profile <aws-profile>
```

Hoặc:

```powershell
.\scripts\verify-data-foundation.ps1 `
  -Profile <aws-profile> `
  -Region ap-southeast-1 `
  -Environment dev
```

Script fail nếu:

- caller không thuộc account `604360241374`;
- thiếu bảng;
- bảng không `ACTIVE`;
- billing không phải `PAY_PER_REQUEST`;
- primary key/GSI khác manifest.

`-SkipSchema` chỉ dùng điều tra inventory ban đầu, không phải acceptance cuối.

## 7. Không deploy create vào bảng đã tồn tại

Không chạy create/deploy thông thường vào prefix `campusmeet-dev` trước import. CloudFormation không tự nhận ownership của bảng tạo ngoài stack và sẽ báo resource đã tồn tại.

Có hai hướng:

### A. Resource import

Dùng khi cần giữ dữ liệu và schema tương thích.

1. Chạy `npm run infra:check`.
2. Chạy AWS verify không dùng `-SkipSchema`.
3. Review TTL, PITR, deletion protection và tags thực tế.
4. Sinh template/import map.
5. Tạo IMPORT change set.
6. Review đủ 17 mapping.
7. Execute import.
8. Chạy drift detection và verify lại.

```powershell
npm run infra:prepare:data

aws cloudformation create-change-set `
  --stack-name campusmeet-data-foundation-dev `
  --change-set-name import-existing-campusmeet-dev `
  --change-set-type IMPORT `
  --template-body file://.aws-sam/data-foundation.generated.json `
  --resources-to-import file://.aws-sam/data-foundation-import.json `
  --parameters `
    ParameterKey=Environment,ParameterValue=dev `
    ParameterKey=TablePrefix,ParameterValue=campusmeet-dev `
    ParameterKey=EnablePointInTimeRecovery,ParameterValue=false `
    ParameterKey=EnableDeletionProtection,ParameterValue=false `
  --profile <aws-profile> `
  --region ap-southeast-1
```

Review:

```powershell
aws cloudformation describe-change-set `
  --stack-name campusmeet-data-foundation-dev `
  --change-set-name import-existing-campusmeet-dev `
  --profile <aws-profile> `
  --region ap-southeast-1
```

Chỉ execute khi 17 resource map đúng bảng:

```powershell
aws cloudformation execute-change-set `
  --stack-name campusmeet-data-foundation-dev `
  --change-set-name import-existing-campusmeet-dev `
  --profile <aws-profile> `
  --region ap-southeast-1
```

### B. Recreate từ IaC

Chỉ dùng khi bảng không chứa dữ liệu cần giữ hoặc đã export/backup và cả nhóm chấp nhận downtime.

1. Xác nhận dữ liệu.
2. Export/backup dữ liệu cần giữ.
3. Xóa bảng cũ có kiểm soát.
4. Deploy generated template.
5. Verify.
6. Nạp lại dữ liệu test.

Không xóa bảng chỉ để làm deploy chạy.

## 8. Deploy môi trường mới

Chỉ dùng prefix chưa tồn tại, ví dụ staging:

```powershell
node scripts/prepare-data-foundation.mjs --prefix campusmeet-staging

aws cloudformation deploy `
  --template-file .aws-sam/data-foundation.generated.json `
  --stack-name campusmeet-data-foundation-staging `
  --parameter-overrides `
    Environment=staging `
    TablePrefix=campusmeet-staging `
    EnablePointInTimeRecovery=true `
    EnableDeletionProtection=true `
  --no-execute-changeset `
  --profile <aws-profile> `
  --region ap-southeast-1
```

Review change set trước execute.

## 9. IAM developer

Group `CampusMeetDevelopers` chỉ cần đọc/ghi item đúng prefix:

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

Không cấp:

- `CreateTable`
- `UpdateTable`
- `DeleteTable`
- IAM
- Billing

`TransactGetItems` và `TransactWriteItems` là API names, không phải IAM actions. Transaction dùng quyền item tương ứng và `ConditionCheckItem`.

## 10. Quy ước dữ liệu

- Timestamp: ISO 8601 UTC.
- TTL: epoch seconds.
- ID sinh ở backend.
- Invitation lưu `tokenHash`, không lưu raw token.
- Mọi record group-scoped mang `groupId`.
- Không tin `userId`, role hoặc `groupId` chỉ vì frontend gửi.
- Mutation quan trọng dùng conditional expression/idempotency.
- Binary/media ở S3 private; DynamoDB chỉ lưu metadata/reference.
- Composite fields phải được backend tạo nhất quán, ví dụ `groupStatus`, `statusCreatedAt`, `versionSort`, `userStatus`.

## 11. Vertical slice đầu tiên

```text
POST /groups
  -> resolve Cognito identity
  -> validate
  -> transaction/conditional write Groups + Memberships
  -> creator = GROUP_ADMIN
  -> safe audit
  -> GET /groups qua UserMembershipsIndex
  -> cross-group denial test
```

Chỉ sau slice này mới đánh dấu application data integration là đã tích hợp một phần.
