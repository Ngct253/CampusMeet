# Hướng dẫn triển khai AWS CampusMeet theo giai đoạn

Tài liệu này là runbook triển khai AWS. Không coi template tồn tại hoặc build thành công là bằng chứng đã deploy.

## 1. Trạng thái

| Giai đoạn                  | Trạng thái                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- |
| Authentication integration | Đã từng deploy và xác minh; stack thử trước đó đã cleanup                        |
| DynamoDB                   | 5 bảng đã deploy và verify; source nằm trong `infra/data-foundation.yaml`        |
| API persistence            | Chưa hoàn thiện; repository vẫn còn skeleton ở các vertical slice chưa implement |
| Upload/live transcript/AI  | Kiến trúc và contract đã chốt; phân công theo kế hoạch nhóm                      |
| Full application stack     | Chưa production-ready                                                            |

Source of truth data model: [Mô hình dữ liệu DynamoDB](dynamodb-data-model.md).

## 2. Stack boundary

CampusMeet tách stack để giảm blast radius:

| Template                      | Vai trò                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `infra/auth-integration.yaml` | Cognito + API/Lambda tối thiểu để xác minh auth                                                       |
| `infra/data-foundation.yaml`  | 5 bảng DynamoDB dùng chung                                                                            |
| `infra/template.yaml`         | Application stack: frontend/API/reminder/Cognito và hạ tầng AI; tham chiếu bảng qua `DataTablePrefix` |

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

## 4. Validate data foundation

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

## 5. Preview data change set

```powershell
sam deploy `
  --template-file infra/data-foundation.yaml `
  --stack-name <data-stack-name> `
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

## 6. Execute data stack

Có thể execute change set trong CloudFormation Console sau review, hoặc chạy lại deploy không có `--no-execute-changeset`:

```powershell
sam deploy `
  --template-file infra/data-foundation.yaml `
  --stack-name <data-stack-name> `
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

## 7. Verify 5 bảng

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
  --stack-name <data-stack-name> `
  --query "Stacks[0].Outputs" `
  --profile <profile> `
  --region ap-southeast-1
```

Lưu bằng chứng outputs trong ticket/PR; không hard-code ARN/account ID vào source.

## 8. Cấu hình application stack

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

Application stack chỉ được deploy sau khi repository dùng đúng 5 biến môi trường và kiểm thử persistence đạt. Thứ tự triển khai chức năng nằm tại [Kế hoạch triển khai nhóm](ke-hoach-trien-khai-nhom.md); cấu trúc code nằm tại [Hướng dẫn cấu trúc repository](huong-dan-cau-truc-repository.md).

## 9. Smoke test data layer

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

## 10. Rollback

Nếu repository/application lỗi:

1. Không xóa data stack ngay vì tables có `Retain`.
2. Rollback application stack/code về phiên bản ổn định gần nhất.
3. Dừng ghi vào 5 bảng nếu mutation chưa an toàn.
4. Đọc CloudFormation Events, Lambda logs và request IDs.
5. Không copy dữ liệu ngược tự động; review mapping và business invariants trước mọi thao tác phục hồi.

## 11. Auth integration

Auth stack vẫn deploy riêng khi cần xác minh Cognito:

```powershell
sam validate `
  --template-file infra/auth-integration.yaml `
  --lint `
  --profile <profile> `
  --region ap-southeast-1

npm run sam:build:auth
```

Frontend dùng `UserPoolId`, `UserPoolClientId`, `ApiUrl` trong `.env`. Các giá trị này là public client config, không phải secret.

## 12. Hạ tầng upload/live transcript/AI

Không cấp `s3:*`, `transcribe:*` hoặc `bedrock:*` rộng cho API Lambda.

- API Lambda: authorization, presign, complete verification, AIJob control.
- Step Functions role: điều phối đúng state machine/service.
- AI Worker role: đọc đúng S3 prefix, cập nhật `ai-work`, gọi provider được cấp.
- Knowledge Base role: đọc data-source prefix và dùng đúng vector store.
- Binary không đi qua API Gateway payload.
- Partial transcript không persist/ingest.
- Log không chứa audio, transcript, prompt, presigned URL hoặc model response nhạy cảm.

Chi tiết: [Thiết kế kỹ thuật upload/live transcript/AI](thiet-ke-ky-thuat-upload-live-transcript-ai.md).

## 13. Chi phí và cleanup

- On-demand vẫn tính phí request/storage/index/backup.
- GSI nhân thêm write/storage cho item có index key.
- PITR, backup, S3 export/import, CloudWatch logs, Step Functions, Transcribe và Bedrock đều có thể phát sinh phí.
- Dev mặc định PITR/deletion protection tắt để dễ cleanup; staging/prod phải review trước khi bật.
- `DeletionPolicy: Retain` ngăn xóa dữ liệu do xóa stack nhầm, nhưng retained table vẫn phát sinh phí và phải quản lý thủ công.
- Sau mỗi phiên integration, kiểm tra CloudFormation stacks, tables, S3 objects, log groups, schedules và AI executions còn tồn tại.
