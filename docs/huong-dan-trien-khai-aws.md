# Hướng dẫn triển khai AWS CampusMeet theo giai đoạn

Tài liệu này là runbook triển khai AWS. Không coi template tồn tại hoặc build thành công là bằng chứng đã deploy.

## 1. Trạng thái

| Giai đoạn | Trạng thái |
| --- | --- |
| Authentication integration | Đã từng deploy và xác minh; stack thử trước đó đã cleanup |
| DynamoDB legacy | 17 bảng dev đã được tạo trước khi review data model; phải audit trước khi xóa |
| DynamoDB v2 | Thiết kế 5 bảng đã có trong `infra/data-foundation.yaml`; cần deploy/verify |
| API persistence | Chưa hoàn thiện; repository vẫn còn skeleton ở các vertical slice chưa implement |
| M5 upload/live transcript/AI | Kiến trúc và contract đã chốt; implementation/deploy theo kế hoạch M5 |
| Full application stack | Chưa production-ready |

Source of truth data model: [Mô hình DynamoDB v2](dynamodb-data-model.md).

## 2. Stack boundary

CampusMeet tách stack để giảm blast radius:

| Template | Vai trò |
| --- | --- |
| `infra/auth-integration.yaml` | Cognito + API/Lambda tối thiểu để xác minh auth |
| `infra/data-foundation.yaml` | 5 bảng DynamoDB dùng chung |
| `infra/template.yaml` | Application stack: frontend/API/reminder/Cognito target; tham chiếu bảng qua `DataTablePrefix` |
| M5 integration template tương lai | S3 user-content, Step Functions, AI Worker, Transcribe/Bedrock/KB và alarms M5 |

`infra/template.yaml` không tạo lại bảng. Data stack phải tồn tại trước application stack.

## 3. Điều kiện trước

- AWS account dev: `604360241374`.
- Region: `ap-southeast-1`.
- AWS CLI và SAM CLI đã cài.
- Node.js 22 LTS và npm 10+.
- Dùng IAM user/profile riêng, không root và không dùng chung access key.
- MFA bật cho người dùng con người.
- Người thực hiện deploy có quyền CloudFormation/SAM/DynamoDB cần thiết.
- Budget alert đã cấu hình.

Kiểm tra identity trước mọi thao tác:

```powershell
aws sts get-caller-identity `
  --profile <profile> `
  --region ap-southeast-1
```

Kết quả `Account` phải là `604360241374`.

## 4. Quy trình chuyển từ 17 bảng sang 5 bảng

### Giai đoạn A — đóng băng schema cũ

- Không thêm GSI hoặc bảng mới trên Console.
- Không viết repository mới dựa vào 17-table layout.
- Không xóa bảng cũ.
- Xác định có Lambda/script/team member nào đang đọc ghi bảng cũ hay không.

### Giai đoạn B — audit read-only

```powershell
powershell -NoProfile -File scripts/audit-legacy-data-foundation.ps1 `
  -Profile <profile> `
  -Region ap-southeast-1 `
  -TablePrefix campusmeet-dev `
  -ExpectedAccountId 604360241374 `
  -ExportCsv legacy-dynamodb-audit.csv
```

Script chỉ gọi describe API và không sửa/xóa bảng.

Review:

- `Exists`;
- `Status`;
- `ItemsApprox`;
- `SizeBytesApprox`;
- PITR;
- deletion protection;
- ARN.

`ItemCount` là số gần đúng. Dù báo 0, vẫn phải xác nhận không có code sử dụng bảng.

### Giai đoạn C — backup khi có dữ liệu

Nếu bất kỳ bảng legacy nào có dữ liệu cần giữ:

1. Tạo on-demand backup, hoặc bật PITR rồi export S3 nếu cần chuyển đổi dữ liệu.
2. Ghi tên backup/export, thời gian, owner và retention.
3. Không import nguyên schema cũ vào stack v2; data model vật lý đã thay đổi.
4. Viết migration theo entity mapping, ví dụ membership legacy → item `GROUP#id/MEMBER#userId`.
5. Kiểm tra số record, checksum/business totals và sample records sau migration.

Nếu tất cả bảng mới tạo và chưa có dữ liệu, ghi lại bằng chứng audit; vẫn không xóa trước khi v2 smoke test đạt.

## 5. Validate data foundation v2

```powershell
sam validate `
  --template-file infra/data-foundation.yaml `
  --lint `
  --profile <profile> `
  --region ap-southeast-1
```

Hoặc:

```powershell
npm run sam:validate:data -- --profile <profile> --region ap-southeast-1
```

Expected resources:

```text
IdentityTable
CollaborationTable
MeetingDataTable
TaskDataTable
AIWorkTable
```

Expected physical names:

```text
campusmeet-dev-identity
campusmeet-dev-collaboration
campusmeet-dev-meeting-data
campusmeet-dev-task-data
campusmeet-dev-ai-work
```

Các tên mới không đụng `campusmeet-dev-meetings` hoặc `campusmeet-dev-tasks` legacy.

## 6. Preview data change set

```powershell
sam deploy `
  --template-file infra/data-foundation.yaml `
  --stack-name campusmeet-dev-data-v2 `
  --resolve-s3 `
  --parameter-overrides `
    Environment=dev `
    TablePrefix=campusmeet-dev `
    EnablePointInTimeRecovery=false `
    EnableDeletionProtection=false `
  --no-execute-changeset `
  --profile <profile> `
  --region ap-southeast-1
```

Review change set:

- đúng 5 `AWS::DynamoDB::Table` tạo mới;
- không delete/replace resource;
- billing `PAY_PER_REQUEST`;
- key `PK/SK`;
- GSI count: identity 2, collaboration 2, meeting-data 3, task-data 3, ai-work 2;
- TTL attribute `expiresAtEpoch`;
- SSE enabled;
- `DeletionPolicy` và `UpdateReplacePolicy` là `Retain`.

Nếu change set có hành động ngoài danh sách trên, không execute.

## 7. Execute data stack

Có thể execute change set trong CloudFormation Console sau review, hoặc chạy lại deploy không có `--no-execute-changeset`:

```powershell
sam deploy `
  --template-file infra/data-foundation.yaml `
  --stack-name campusmeet-dev-data-v2 `
  --resolve-s3 `
  --parameter-overrides `
    Environment=dev `
    TablePrefix=campusmeet-dev `
    EnablePointInTimeRecovery=false `
    EnableDeletionProtection=false `
  --profile <profile> `
  --region ap-southeast-1
```

Không đóng terminal khi chưa đọc kết quả. Nếu stack thất bại, đọc Events trước khi retry.

## 8. Verify 5 bảng

```powershell
powershell -NoProfile -File scripts/verify-data-foundation.ps1 `
  -Profile <profile> `
  -Region ap-southeast-1 `
  -TablePrefix campusmeet-dev `
  -ExpectedAccountId 604360241374
```

Script kiểm tra:

- bảng tồn tại và `ACTIVE`;
- `PAY_PER_REQUEST`;
- primary key `PK/SK`;
- đúng GSI;
- TTL bật trên `expiresAtEpoch`;
- tag `DataModelVersion=2`.

Đọc outputs:

```powershell
aws cloudformation describe-stacks `
  --stack-name campusmeet-dev-data-v2 `
  --query "Stacks[0].Outputs" `
  --profile <profile> `
  --region ap-southeast-1
```

Lưu bằng chứng outputs trong ticket/PR; không hard-code ARN/account ID vào source.

## 9. Cấu hình application stack

`infra/template.yaml` nhận:

```text
Environment=dev
DataTablePrefix=campusmeet-dev
```

Lambda environment nhận:

```dotenv
IDENTITY_TABLE=campusmeet-dev-identity
COLLABORATION_TABLE=campusmeet-dev-collaboration
MEETING_DATA_TABLE=campusmeet-dev-meeting-data
TASK_DATA_TABLE=campusmeet-dev-task-data
AI_WORK_TABLE=campusmeet-dev-ai-work
```

Validate application template:

```powershell
sam validate `
  --template-file infra/template.yaml `
  --lint `
  --profile <profile> `
  --region ap-southeast-1
```

Application stack chỉ được deploy sau khi code repository đã biết key contract v2. Nếu repository vẫn dùng tên `GROUPS_TABLE`, `MEETINGS_TABLE`, `TASKS_TABLE` hoặc `NOTIFICATIONS_TABLE`, chưa deploy application stack mới.

## 10. Thứ tự implement repository

### Vertical slice 1 — group

1. Tạo `DynamoDbGroupRepository` và membership repository trên `collaboration`.
2. Transaction tạo group + creator admin membership + audit.
3. Query group của user qua GSI1.
4. Test từ chối truy cập group khác.

### Vertical slice 2 — meeting/minutes/reminder

1. Meeting aggregate trong `meeting-data`.
2. Query timeline group qua GSI1.
3. Minutes version và attendee/agenda cùng meeting partition.
4. Reminder item + Scheduler state/idempotency.
5. Reminder Lambda đọc `meeting-data`, ghi notification vào `identity`.

### Vertical slice 3 — tasks/dashboard

1. Task metadata trong `task-data`.
2. GSI theo group/status/due, assignee/due và meeting.
3. Không dùng Scan cho dashboard.

### Vertical slice 4 — upload/live transcript

1. Attachment metadata trong meeting aggregate; binary ở S3.
2. Recording/consent và live session trong `meeting-data`.
3. Transcript metadata + final segment partition.
4. Retry segment không tạo duplicate.
5. Complete upload tạo đúng một AIJob trong `ai-work`.

### Vertical slice 5 — RAG/proposal

1. KnowledgeSource/version trong `ai-work`.
2. Normalized source ở S3.
3. Bedrock retrieval filter `groupId`, approved status và optional meeting set trước model.
4. Conversation/message/citation trong `ai-work`.
5. Task/tool proposal confirm bằng version + idempotency + API nghiệp vụ chuẩn.

## 11. Local và shared dev

### Unit test

Dùng in-memory repository. Unit test không gọi AWS thật.

### Local integration

Dùng DynamoDB Local với cùng 5 table/key contract. Local endpoint chỉ được bật bằng config development.

### AWS shared dev

- Mỗi thành viên dùng profile/IAM user riêng.
- Không dùng chung password/access key.
- Không tạo table/GSI trực tiếp.
- Test item có `createdBy` và ID prefix thành viên/feature.
- Không dùng dữ liệu cá nhân thật.
- Chỉ owner infra deploy stack.

Frontend không gọi DynamoDB trực tiếp:

```text
React → API Gateway → Lambda → DynamoDB
```

## 12. Smoke test data layer

Data stack chỉ chứng minh hạ tầng. Sau khi repository được implement, smoke test tối thiểu:

1. Đăng nhập Cognito.
2. Tạo group.
3. Đọc group và creator membership.
4. Mời/chấp nhận thành viên bằng token hash.
5. Tạo meeting và query timeline group.
6. Lưu minutes version.
7. Tạo/update task và query dashboard theo GSI.
8. Tạo notification và mark read.
9. Complete upload retry hai lần nhưng chỉ có một AIJob.
10. Gửi lại final transcript segment cùng sequence nhưng không duplicate.
11. Query RAG group A không trả source group B.

Lưu request ID và kết quả; không lưu token/password/content nhạy cảm.

## 13. Khi nào được xóa 17 bảng cũ

Chỉ xóa khi tất cả điều kiện sau đạt:

- audit report đã lưu;
- backup/export đã có nếu cần;
- 5 bảng v2 verify đạt;
- code search không còn tên bảng legacy trong runtime config;
- repository v2 đã deploy;
- core smoke test đạt;
- M5 path sử dụng `meeting-data`/`ai-work` đúng contract;
- không có Lambda/script/team member đang dùng legacy;
- có reviewer thứ hai xác nhận danh sách xóa.

Xóa từng bảng, không chạy wildcard delete. Sau mỗi lần xóa kiểm tra lại application logs. Giữ bảng cũ thêm một khoảng review nếu ngân sách cho phép.

## 14. Rollback

Nếu repository/application v2 lỗi:

1. Không xóa data stack ngay vì tables có `Retain`.
2. Rollback application stack/code về phiên bản trước.
3. Dừng writes v2 nếu mutation chưa an toàn.
4. Đọc CloudFormation Events, Lambda logs và request IDs.
5. Nếu đã migrate dữ liệu, không copy ngược tự động; review mapping và business invariants.
6. Legacy tables chỉ được dùng lại khi code/config cũ còn nguyên và owner xác nhận.

## 15. Auth integration

Auth stack vẫn deploy riêng khi cần xác minh Cognito:

```powershell
sam validate `
  --template-file infra/auth-integration.yaml `
  --lint `
  --profile <profile> `
  --region ap-southeast-1

npm run sam:build:auth
```

Frontend dùng `UserPoolId`, `UserPoolClientId`, `ApiUrl` trong `.env.local`. Các giá trị này là public client config, không phải secret.

## 16. M5 infrastructure gate

Không cấp `s3:*`, `transcribe:*` hoặc `bedrock:*` rộng cho API Lambda.

- API Lambda: authorization, presign, complete verification, AIJob control.
- Step Functions role: điều phối đúng state machine/service.
- AI Worker role: đọc đúng S3 prefix, cập nhật `ai-work`, gọi provider được cấp.
- Knowledge Base role: đọc data-source prefix và dùng đúng vector store.
- Binary không đi qua API Gateway payload.
- Partial transcript không persist/ingest.
- Log không chứa audio, transcript, prompt, presigned URL hoặc model response nhạy cảm.

Chi tiết: [Kế hoạch M5](ke-hoach-m5-upload-transcript-ai.md).

## 17. Chi phí và cleanup

- On-demand vẫn tính phí request/storage/index/backup.
- GSI nhân thêm write/storage cho item có index key.
- PITR, backup, S3 export/import, CloudWatch logs, Step Functions, Transcribe và Bedrock đều có thể phát sinh phí.
- Dev mặc định PITR/deletion protection tắt để dễ cleanup; staging/prod phải review trước khi bật.
- `DeletionPolicy: Retain` ngăn xóa dữ liệu do xóa stack nhầm, nhưng retained table vẫn phát sinh phí và phải quản lý thủ công.
- Sau mỗi phiên integration, kiểm tra CloudFormation stacks, tables, S3 objects, log groups, schedules và AI executions còn tồn tại.
