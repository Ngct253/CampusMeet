# CampusMeet

CampusMeet quản lý quy trình **trước, trong và sau cuộc họp** cho nhóm học tập, đồ án và dự án nhỏ: tạo nhóm, lập lịch, ghi biên bản, chuyển action item thành task, live transcription, hỏi đáp có citation và theo dõi tiến độ.

CampusMeet không clone Google Meet. Google Meet là dịch vụ ngoài được tích hợp qua Google Calendar/Meet APIs; CampusMeet web và Meet Add-on dùng chung API, dữ liệu và authorization.

## Trạng thái hiện tại

Repository đang chuyển từ scaffold sang các vertical slice tích hợp thật.

| Thành phần | Trạng thái |
| --- | --- |
| Frontend | Có application shell, Cognito auth thật khi có env; nhiều màn hình nghiệp vụ vẫn dùng mock |
| Backend | Có `/health`, `/me` và handler skeleton; repository nghiệp vụ chưa hoàn thiện |
| Cognito | Đã deploy/kiểm thử bằng auth integration stack; stack thử trước đó đã cleanup |
| DynamoDB legacy | Account dev hiện có 17 bảng cũ được tạo trước khi review data model; chưa xóa |
| DynamoDB v2 | Đã chốt thiết kế 5 bảng trong IaC; cần deploy và verify lại |
| Google Calendar/Meet | Contract/kiến trúc đã chốt; adapter thật chưa hoàn thiện |
| M5 AI | Đã chốt upload, live transcript, AIJob, Knowledge Base RAG nhiều meeting và citation; implementation còn theo kế hoạch M5 |
| Full deployment | Chưa production-ready; triển khai theo từng stack/giai đoạn |

Việc bảng AWS tồn tại không có nghĩa backend đã kết nối persistence thật. Data layer chỉ hoàn thành khi repository, authorization, transaction và integration tests đạt.

## DynamoDB data model v2

CampusMeet dùng 5 bảng vật lý theo access pattern:

```text
campusmeet-dev-identity
campusmeet-dev-collaboration
campusmeet-dev-meeting-data
campusmeet-dev-task-data
campusmeet-dev-ai-work
```

- `identity`: user, preference, Google integration reference, OAuth state, notification.
- `collaboration`: group, membership, invitation, audit event.
- `meeting-data`: meeting, attendee, agenda, minutes, reminder, attachment metadata, recording, consent, live session, transcript và segment.
- `task-data`: task và task history, index theo group/assignee/meeting.
- `ai-work`: AIJob, KnowledgeSource, conversation/message/citation, task/tool proposal và idempotency.

Entity logic không bị xóa khi giảm từ 17 xuống 5 bảng; chúng được lưu bằng composite `PK/SK` và sparse GSI. Binary/audio nằm trong S3, vector nằm trong Bedrock Knowledge Bases/S3 Vectors.

Đọc chi tiết tại [Mô hình dữ liệu DynamoDB v2](docs/dynamodb-data-model.md).

## Công nghệ

- Frontend: React, TypeScript, Vite, React Router, TanStack Query boundary.
- Backend: Node.js/TypeScript trên AWS Lambda.
- Auth/API: Cognito User Pool, API Gateway HTTP API.
- Data: DynamoDB 5-table model, S3 user-content.
- Workflow/AI mục tiêu: EventBridge Scheduler, Step Functions, Amazon Transcribe, Amazon Bedrock, Bedrock Knowledge Bases và S3 Vectors.
- Vận hành: CloudWatch, SNS, SES.
- IaC: AWS SAM/CloudFormation.

Đây là target architecture; trạng thái thật phải dựa trên CloudFormation outputs, smoke tests và logs.

## Điều kiện chạy local

- Node.js 22 LTS.
- npm 10 trở lên.
- AWS CLI và AWS SAM CLI khi validate/deploy AWS.
- PowerShell cho các script audit/verify hiện tại.

```bash
git clone <repository-url>
cd CampusMeet
npm install
npm run dev
```

`npm run dev` khởi động Vite tại `http://localhost:5173`.

## Cấu hình Cognito frontend

Một thành viên deploy auth stack; các thành viên khác chỉ nhận ba output public trong `apps/web/.env.local`:

```dotenv
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_USER_POOL_CLIENT_ID=<UserPoolClientId>
VITE_API_BASE_URL=<ApiUrl>
```

Không commit `.env.local`, token, password hoặc AWS credential.

Validate/build auth:

```powershell
aws sts get-caller-identity --profile <profile>

sam validate `
  --template-file infra/auth-integration.yaml `
  --lint `
  --profile <profile> `
  --region ap-southeast-1

npm run sam:build:auth
```

Chi tiết nằm tại [Hướng dẫn cấu hình đăng nhập](docs/huong-dan-cau-hinh-dang-nhap.md).

## Triển khai lại DynamoDB dev

### 1. Audit 17 bảng cũ — không sửa/xóa

```powershell
powershell -NoProfile -File scripts/audit-legacy-data-foundation.ps1 `
  -Profile <profile> `
  -Region ap-southeast-1 `
  -ExpectedAccountId 604360241374 `
  -ExportCsv legacy-dynamodb-audit.csv
```

Nếu bất kỳ bảng nào có dữ liệu, tạo backup/export và review migration trước khi xóa.

### 2. Validate data template

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

### 3. Preview change set

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

Review change set. Nó phải tạo đúng 5 bảng mới và không sửa/xóa 17 bảng legacy.

### 4. Execute và verify

Sau khi execute change set:

```powershell
powershell -NoProfile -File scripts/verify-data-foundation.ps1 `
  -Profile <profile> `
  -Region ap-southeast-1 `
  -TablePrefix campusmeet-dev `
  -ExpectedAccountId 604360241374
```

Không xóa bảng cũ chỉ vì verify v2 đạt. Backend phải chuyển sang 5 biến môi trường mới và smoke test xong trước.

## Biến môi trường backend

Application stack truyền:

```dotenv
IDENTITY_TABLE=campusmeet-dev-identity
COLLABORATION_TABLE=campusmeet-dev-collaboration
MEETING_DATA_TABLE=campusmeet-dev-meeting-data
TASK_DATA_TABLE=campusmeet-dev-task-data
AI_WORK_TABLE=campusmeet-dev-ai-work
```

Lambda dùng IAM execution role; không đặt access key vào env của Lambda.

Local development nên dùng in-memory repository hoặc DynamoDB Local. Shared AWS dev chỉ dùng cho integration/smoke test.

## Quy trình nhóm với database

1. Chốt use case và access pattern.
2. Cập nhật key contract trong `docs/dynamodb-data-model.md` nếu thật sự cần.
3. Owner infra review mọi thay đổi GSI/table.
4. Developer code qua repository interface; handler không query DynamoDB trực tiếp.
5. Unit test bằng in-memory repository.
6. Local integration bằng DynamoDB Local.
7. PR chạy lint/typecheck/test/build.
8. Chỉ owner infra deploy shared AWS dev.
9. Integration test dùng dữ liệu có prefix/`createdBy` của từng thành viên.
10. Không tự tạo index/table bằng Console.

## Kiểm tra chất lượng

| Lệnh | Mục đích |
| --- | --- |
| `npm run lint` | ESLint toàn monorepo |
| `npm run typecheck` | TypeScript strict check |
| `npm run test` | Vitest |
| `npm run build` | Build workspaces/frontend |
| `npm run format:check` | Kiểm tra Prettier |
| `npm run sam:validate:data` | Validate data foundation |
| `npm run aws:audit:legacy-data` | Audit read-only 17 bảng cũ |
| `npm run aws:verify:data` | Verify 5 bảng v2 |

Trước Pull Request chạy ít nhất `lint`, `typecheck`, `test`, `build` và validation liên quan tới file đã sửa.

## Cấu trúc repository

```text
apps/web/          React/Vite frontend
services/api/      API Lambda, application/domain/repository boundaries
packages/shared/   Shared types, enums, DTO
infra/             Auth stack, data stack và application stack
scripts/           AWS audit/verification helpers
docs/              SRS, kiến trúc, API contract và runbook
.github/           CI quality gates
```

## Tài liệu chính

- [Mô hình dữ liệu DynamoDB v2](docs/dynamodb-data-model.md)
- [Kiến trúc hệ thống](docs/architecture.md)
- [Kế hoạch M5 upload/transcript/AI](docs/ke-hoach-m5-upload-transcript-ai.md)
- [Hướng dẫn triển khai AWS](docs/huong-dan-trien-khai-aws.md)
- [Hướng dẫn cấu trúc repository](docs/huong-dan-cau-truc-repository.md)
- [API contract](docs/api-contract.md)
- [SRS](docs/CampusMeet-SRS.md)

## Bảo mật và chi phí

- Không dùng root account cho công việc hằng ngày; bật MFA.
- Không dùng chung IAM user/access key.
- Không commit secret, token, AWS credential hoặc dữ liệu người dùng thật.
- Review account, Region, change set, IAM và chi phí trước deploy.
- `PAY_PER_REQUEST` không đồng nghĩa chi phí luôn bằng 0.
- Bật PITR/deletion protection cho staging/prod sau khi review chi phí và cleanup policy.
- Binary ở S3 phải private, presigned URL ngắn hạn và kiểm tra checksum/metadata.
- Retrieval AI phải filter quyền trước khi model nhận dữ liệu.
