# Hướng dẫn triển khai AWS CampusMeet theo giai đoạn

Tài liệu này là runbook AWS chung. Validate/build thành công không đồng nghĩa resource đã deploy hoặc feature đã production-ready.

## 1. Trạng thái

| Giai đoạn | Trạng thái |
| --- | --- |
| Auth integration | Đã xác minh sign-up/confirmation/sign-in, `/health`, `/me`; stack thử nghiệm đã cleanup |
| Data inventory | 17 bảng `campusmeet-dev-*` đã tồn tại tại account `604360241374`, Region `ap-southeast-1` |
| Data IaC ownership | Chưa hoàn tất; cần verify rồi import/recreate |
| Data application integration | Chưa triển khai repository persistence thật |
| Google/Reminder/Hosting/Observability | Chưa chạy end-to-end |
| M5 AI | Baseline đã chốt trong SRS/kế hoạch M5; chưa deploy pipeline thật |
| Full deployment | Chưa production-ready |

## 2. Stack boundaries

| Phạm vi | Source |
| --- | --- |
| Auth verification | `infra/auth-integration.yaml` |
| Data manifest | `infra/data-foundation.spec.json` |
| Data generated template/import map | `scripts/prepare-data-foundation.mjs` → `.aws-sam/` |
| Application target stack | `infra/template.yaml` |

Application stack không tạo DynamoDB table.

## 3. Nguyên tắc

- Không dùng root account.
- Mỗi thành viên dùng IAM user riêng và MFA.
- Không commit credential/token/secret.
- Không deploy trước khi xác nhận account, Region và change set.
- Không xóa bảng để làm deployment chạy.
- Không cấp developer quyền schema/IAM/Billing.
- DynamoDB dev dùng `PAY_PER_REQUEST`.
- PITR, data-event logging, Transcribe, Bedrock, logs và vector storage có thể phát sinh phí.
- CI chỉ validate; không tự deploy/import/cleanup.

## 4. Quality gates

```powershell
npm ci
npm run infra:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run format:check
```

## 5. Auth integration

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

Preview:

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

Acceptance:

- `/health` không token → `200`;
- `/me` không token → `401`;
- sign-up/confirmation/sign-in/sign-out chạy;
- token/credential không xuất hiện trong log/evidence.

Cleanup integration stack khi không cần giữ.

## 6. Data foundation

### 6.1 Generate và validate

```powershell
npm run infra:prepare:data
npm run infra:check
npm run sam:validate:data
```

Generated artifacts:

```text
.aws-sam/data-foundation.generated.json
.aws-sam/data-foundation-import.json
```

### 6.2 Verify AWS read-only

```powershell
npm run aws:verify:data -- -Profile <aws-profile>
```

Acceptance:

- đúng account `604360241374`;
- Region `ap-southeast-1`;
- đủ 17 bảng;
- mọi bảng `ACTIVE`;
- billing `PAY_PER_REQUEST`;
- primary key/GSI khớp manifest.

### 6.3 Import existing tables

Không deploy create vào `campusmeet-dev-*` khi bảng đã tồn tại.

```powershell
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

Review change set và đủ 17 mapping trước execute. Sau import:

1. chờ stack hoàn tất;
2. chạy drift detection;
3. chạy verify script lại;
4. kiểm tra tags/TTL/PITR/deletion protection;
5. lưu evidence an toàn.

Chi tiết tại [huong-dan-data-foundation.md](huong-dan-data-foundation.md).

## 7. Application data integration

Vertical slice đầu tiên:

```text
POST /groups
  -> JWT identity
  -> validate
  -> Groups + Memberships(GROUP_ADMIN)
  -> audit
  -> GET /groups
  -> cross-group denial
```

Điều kiện trước:

- data verify pass;
- AWS SDK dependency + lockfile;
- table names từ environment;
- handler/application/domain/repository boundaries rõ;
- backend không tin `userId` hoặc role frontend gửi.

Acceptance:

- create group không tạo record nửa chừng;
- creator là active admin;
- retry không tạo dữ liệu trùng;
- user nhóm khác nhận `403`;
- route đã làm không còn `501`;
- log không chứa token/dữ liệu nhạy cảm.

## 8. Application stack

Preview full target stack chỉ sau khi các slice liên quan đủ điều kiện:

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

Không execute toàn bộ stack chỉ để thử một repository.

## 9. Google integration

- OAuth token server-side.
- Meeting nội bộ lưu trước khi gọi Google.
- `meetingStatus` và `googleSyncStatus` độc lập.
- Retry/idempotency không tạo event trùng.
- Meet link chỉ hiển thị khi `READY`.
- Artifact không có là kết quả hợp lệ; dùng upload/capture fallback.

## 10. Reminder/Notification

- One-time schedule có idempotency key.
- Meeting hủy không gửi reminder.
- Reminder Lambda kiểm tra trạng thái cuối.
- In-app notification tạo trước; SES failure không rollback dữ liệu.
- IAM role chỉ đọc meeting/reminder và ghi notification cần thiết.

## 11. M5 upload/transcript/AI

Thực hiện theo [ke-hoach-m5-upload-transcript-ai.md](ke-hoach-m5-upload-transcript-ai.md):

- consent/capture rõ ràng;
- live transcription ưu tiên tiếng Việt;
- binary upload trực tiếp S3;
- job dài bất đồng bộ;
- RAG filter `groupId`/meeting-set/ACL trước retrieval;
- citation bắt buộc;
- proposal/mutation cần preview, authorization, confirmation và idempotency;
- retention/cost/cleanup xuyên S3, DynamoDB, Knowledge Base và vectors.

## 12. Hosting và observability

Hosting:

- S3 private;
- CloudFront OAC;
- SPA fallback;
- CORS đúng origin;
- không public bucket.

Observability:

- structured logs có request ID;
- không log token/audio/transcript/prompt nhạy cảm;
- Lambda/API/Reminder/AI metrics;
- ít nhất một alarm và SNS evidence;
- retention/cost được review.

## 13. Cleanup

Auth/application integration stack có thể cleanup sau test.

Data foundation không cleanup cùng nhịp nếu:

- đang dùng chung;
- có dữ liệu cần giữ;
- chưa backup/export;
- chưa có owner đồng ý.

Trước delete:

1. xác nhận account/Region;
2. liệt kê resource;
3. kiểm tra dữ liệu/backups/deletion protection;
4. ghi recovery plan;
5. chỉ admin execute;
6. verify trạng thái và chi phí sau cleanup.

## 14. Definition of done cho thay đổi AWS

- source/generated template pass;
- change set/import plan được review;
- IAM least privilege;
- test/verify pass;
- docs đồng bộ;
- security/cost/retention/cleanup được ghi;
- không có secret;
- PR nêu migration và rollback.
