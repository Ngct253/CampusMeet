# Hướng dẫn triển khai AWS CampusMeet theo giai đoạn

Tài liệu này là runbook AWS chung cho CampusMeet. Nhóm dùng stack nhỏ theo phạm vi để xác minh từng nhóm dịch vụ trước khi triển khai application stack. Build/validate thành công không có nghĩa resource đã deploy hoặc feature đã production-ready.

## 1. Trạng thái xác minh

| Giai đoạn | Trạng thái | Bằng chứng hiện có |
| --- | --- | --- |
| Authentication integration | **Đã thực hành và xác minh; stack thử nghiệm đã cleanup** | SAM validate/build đạt; Cognito sign-up/confirmation/sign-in đạt; `/health` trả `200`; `/me` không token trả `401` |
| Data foundation inventory | **17 bảng dev đã được người quản trị xác nhận là đã tạo** | Prefix `campusmeet-dev`, account `604360241374`, Region `ap-southeast-1` |
| Data foundation IaC ownership | **Chưa xác minh hoàn tất** | `infra/data-foundation.yaml` đã mô tả source of truth; cần verify schema và import/recreate trước khi coi CloudFormation là owner |
| Data application integration | **Chưa triển khai** | API handler vẫn skeleton; DynamoDB repositories chưa đọc/ghi thật |
| Notifications | **Chưa triển khai thực tế** | Chưa có bằng chứng EventBridge Scheduler/Reminder/SES end-to-end |
| Frontend hosting | **Chưa triển khai thực tế** | Chưa có bằng chứng S3/CloudFront active cho application |
| Observability | **Chưa xác minh full stack** | Chưa demo alarm/SNS cho application |
| Full deployment | **Chưa triển khai** | Chỉ thực hiện sau khi từng slice có test và cleanup owner |

Không dùng trạng thái “bảng đã tồn tại” để tuyên bố API đã tích hợp database.

## 2. Source of truth theo stack

| Template | Phạm vi |
| --- | --- |
| `infra/auth-integration.yaml` | Cognito, HTTP API và Lambda auth tối thiểu |
| `infra/data-foundation.yaml` | 17 DynamoDB table |
| `infra/template.yaml` | Application stack dùng `DataTablePrefix`, không tạo table |

Tách stack giúp tránh bảng trùng, giữ vòng đời data độc lập compute và làm rõ import/cleanup.

## 3. Nguyên tắc kiến trúc, bảo mật và chi phí

- Chỉ deploy tài nguyên tối thiểu cần cho test hiện tại.
- Không dùng EC2, RDS, NAT Gateway, Docker hoặc ECS cho MVP hiện tại.
- Tạo change set và review IAM, retention, deletion impact và chi phí trước execute.
- Không dùng AWS root account; bật MFA.
- Mỗi thành viên dùng IAM user riêng trong group `CampusMeetDevelopers`.
- Không chia sẻ password, MFA hoặc access key.
- Không hard-code credential/token vào source.
- DynamoDB dev dùng `PAY_PER_REQUEST`.
- PITR, CloudTrail data events, log retention và backup có thể phát sinh phí.
- Không cấp developer quyền `CreateTable`, `UpdateTable`, `DeleteTable`, IAM hoặc Billing.
- Không xóa/recreate bảng để “làm deploy chạy” khi chưa xác nhận dữ liệu và migration.

## 4. Workflow chuẩn

1. Ghi rõ outcome và điều kiện hoàn thành.
2. Liệt kê resource hiện có và dự kiến thay đổi.
3. Xác nhận account, Region và profile.
4. Kiểm tra công cụ, quyền, budget và dữ liệu test.
5. Chạy lint/typecheck/test/template validation.
6. Tạo change set nhưng chưa execute.
7. Review resource diff, IAM, retention và cleanup.
8. Deploy/import sau review.
9. Đọc outputs qua CloudFormation/AWS CLI.
10. Cấu hình local nhưng không commit secret.
11. Smoke test và end-to-end authorization/failure path.
12. Lưu evidence không chứa dữ liệu nhạy cảm.
13. Review resource/cost cuối cùng.
14. Cleanup hoặc retain theo owner đã chốt.
15. Verify trạng thái cuối và drift.

## 5. Authentication integration

### Validate/build

```powershell
aws sts get-caller-identity `
  --profile <aws-profile> `
  --region ap-southeast-1

sam validate `
  --template-file infra/auth-integration.yaml `
  --lint `
  --profile <aws-profile> `
  --region ap-southeast-1

npm run sam:build:auth
```

### Preview

```powershell
sam deploy `
  --template-file infra/auth-integration.yaml `
  --stack-name campusmeet-auth-integration-dev `
  --resolve-s3 `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides AllowedOrigin=http://localhost:5173 `
  --no-execute-changeset `
  --profile <aws-profile> `
  --region ap-southeast-1
```

Review rồi execute. Sau test, cleanup integration stack nếu chưa cần giữ môi trường.

## 6. Data foundation

### 6.1 Kiểm tra inventory/schema

```powershell
.\scripts\verify-data-foundation.ps1 `
  -Profile <aws-profile> `
  -Region ap-southeast-1 `
  -Environment dev
```

Kết quả pass cần:

- account `604360241374`;
- đủ 17 bảng `campusmeet-dev-*`;
- tất cả `ACTIVE`;
- billing `PAY_PER_REQUEST`;
- key schema/GSI khớp `infra/data-foundation.yaml`.

Nếu chưa biết schema hiện tại, dùng `-SkipSchema` để điều tra inventory trước. Đây không phải acceptance cuối.

### 6.2 Validate template

```powershell
sam validate `
  --template-file infra/data-foundation.yaml `
  --lint `
  --profile <aws-profile> `
  --region ap-southeast-1
```

### 6.3 Không create khi bảng đã tồn tại

Không chạy deploy create thông thường vào dev nếu 17 bảng cùng tên đang tồn tại. CloudFormation không tự nhận ownership của resource tạo ngoài stack.

Chọn một hướng đã review:

- **Resource import:** giữ bảng/dữ liệu hiện tại nếu schema tương thích.
- **Recreate:** chỉ khi không có dữ liệu cần giữ hoặc đã backup/export và chấp nhận downtime.

Chi tiết nằm trong [Hướng dẫn DynamoDB data foundation](huong-dan-data-foundation.md).

### 6.4 Preview cho môi trường mới

Chỉ áp dụng khi prefix chưa tồn tại:

```powershell
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

Không execute khi chưa đọc đủ 17 resources/indexes.

### 6.5 Acceptance data foundation

- verify script pass;
- CloudFormation import/deploy thành công;
- drift detection sạch;
- table names/keys/indexes khớp;
- developer IAM chỉ đọc/ghi item đúng prefix;
- cost settings đã review.

## 7. Data application integration

Vertical slice đầu tiên:

```text
POST /groups
  -> JWT identity
  -> validate
  -> write Groups + Memberships
  -> audit
  -> GET /groups
  -> authorization test
```

Điều kiện trước:

- data foundation verify pass;
- table prefix truyền qua application stack/env;
- shared DTO đã review;
- AWS SDK dependency được thêm kèm lockfile;
- repository port/adapter rõ ràng;
- không tin user/role từ frontend.

Acceptance:

- unit test domain/application;
- repository integration test;
- create group không tạo record nửa chừng;
- creator trở thành active `GROUP_ADMIN`;
- user khác không đọc được group;
- retry không tạo dữ liệu trùng;
- handler không còn `501` cho route đã triển khai;
- log không chứa token/raw sensitive data.

## 8. Application stack

`infra/template.yaml` dùng `DataTablePrefix`, mặc định `campusmeet-dev`, và không tạo table.

```powershell
sam validate `
  --template-file infra/template.yaml `
  --lint `
  --profile <aws-profile> `
  --region ap-southeast-1

sam deploy `
  --template-file infra/template.yaml `
  --stack-name campusmeet-app-dev `
  --resolve-s3 `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides `
    Environment=dev `
    DataTablePrefix=campusmeet-dev `
    DomainName=example.invalid `
    GoogleSecretReference=/campusmeet/dev/google-oauth `
  --no-execute-changeset `
  --profile <aws-profile> `
  --region ap-southeast-1
```

Application stack vẫn là target stack; không execute toàn bộ chỉ để thử data layer.

## 9. Notifications

Mục tiêu:

- one-time reminder;
- meeting bị hủy không gửi;
- notification được tạo trước;
- SES failure không làm mất notification;
- retry/idempotency rõ ràng.

## 10. Frontend hosting

Mục tiêu:

- React production build;
- S3 private;
- CloudFront OAC;
- SPA fallback;
- CORS/API origin đúng;
- refresh protected route hoạt động.

Không public S3 bucket.

## 11. Observability

Mục tiêu:

- structured log có request ID;
- không log token/audio/transcript/prompt nhạy cảm;
- Lambda errors/latency metrics;
- ít nhất một alarm có thể demo;
- SNS recipient được xác nhận;
- log retention/cost được review.

## 12. IAM developer access

Developer policy cho phép list/describe table và đọc/ghi item đúng prefix. Không dùng IAM actions không tồn tại:

```text
dynamodb:TransactGetItems
dynamodb:TransactWriteItems
```

Transaction được kiểm tra bằng quyền item tương ứng và `dynamodb:ConditionCheckItem`.

## 13. Cleanup và dữ liệu

Auth integration stack có thể cleanup sau test.

Data foundation không cleanup theo cùng nhịp application/auth khi:

- chứa dữ liệu cần giữ;
- đang được team dùng chung;
- chưa export/backup;
- chưa có owner đồng ý.

Trước mọi delete:

1. xác nhận account/Region;
2. liệt kê resource;
3. xác nhận dữ liệu;
4. kiểm tra deletion protection/PITR/backups;
5. ghi recovery plan;
6. chỉ người quản trị execute.

## 14. Definition of done

Một thay đổi AWS chỉ hoàn tất khi:

- template validate;
- change set/import plan được review;
- README/architecture/runbook đồng bộ;
- IAM least privilege;
- script verify hoặc smoke test pass;
- cost/retention/cleanup được ghi;
- không có secret;
- PR mô tả impact và rollback.
