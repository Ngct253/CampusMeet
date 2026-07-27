# CampusMeet

CampusMeet quản lý quy trình **trước, trong và sau cuộc họp** cho nhóm học tập hoặc dự án nhỏ: nhóm/thành viên, lịch họp, Google Calendar/Meet, nhắc lịch, biên bản, công việc, transcript và trợ lý AI có citation. CampusMeet không xây video call riêng.

## Trạng thái hiện tại

| Thành phần | Trạng thái |
| --- | --- |
| Frontend | Application shell; auth thật khi có env; nghiệp vụ vẫn còn mock |
| Cognito | Sign-up, confirmation, sign-in, sign-out và protected route đã được xác minh; integration stack trước đó đã cleanup |
| Backend | Có `/health`, `/me` cho auth integration; API nghiệp vụ còn skeleton/`501` |
| DynamoDB infrastructure | 17 bảng `campusmeet-dev-*` đã được tạo tại account `604360241374`, Region `ap-southeast-1` |
| DynamoDB IaC ownership | Chưa hoàn tất; cần verify schema rồi import/recreate bằng CloudFormation |
| DynamoDB application integration | Chưa có repository persistence thật |
| Google/Reminder/Hosting/Observability | Chưa chạy end-to-end |
| M5 AI | Baseline đã chốt: live transcription sau consent, upload trực tiếp S3, transcript, RAG current/selected/whole-group trong cùng `groupId`, citation và human confirmation |

Bảng đã tồn tại **không đồng nghĩa** backend đã kết nối database.

## Công nghệ

- React, TypeScript, Vite.
- Node.js/TypeScript trên AWS Lambda.
- AWS SAM/CloudFormation, Cognito, API Gateway, DynamoDB, S3, CloudFront, EventBridge Scheduler, SES, CloudWatch/SNS.
- AI mục tiêu: Step Functions, Amazon Transcribe, Amazon Bedrock, Bedrock Knowledge Bases và S3 Vectors.

## Chạy local

Yêu cầu: Node.js 22 LTS và npm 10+.

```bash
git clone <repository-url>
cd CampusMeet
npm install
npm run dev
```

Frontend mặc định chạy tại `http://localhost:5173`.

## Cấu hình auth

Tạo `apps/web/.env.local` từ `.env.example`:

```dotenv
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_USER_POOL_CLIENT_ID=<UserPoolClientId>
VITE_API_BASE_URL=<ApiUrl>
```

Ba giá trị này là public frontend configuration, không phải secret. Không commit `.env.local`.

Auth integration dùng:

```powershell
sam validate `
  --template-file infra/auth-integration.yaml `
  --lint `
  --profile <aws-profile> `
  --region ap-southeast-1

npm run sam:build:auth
```

Đọc hướng dẫn đầy đủ tại [docs/huong-dan-cau-hinh-dang-nhap.md](docs/huong-dan-cau-hinh-dang-nhap.md).

## Data foundation

### Source of truth

| File | Vai trò |
| --- | --- |
| `infra/data-foundation.spec.json` | Manifest 17 bảng, primary key, GSI và TTL |
| `scripts/prepare-data-foundation.mjs` | Sinh CloudFormation template và resource import map |
| `scripts/verify-data-foundation.ps1` | Kiểm tra read-only trên AWS |
| `infra/template.yaml` | Application stack sử dụng bảng qua `DataTablePrefix`; không tạo bảng |

### 17 bảng dev

```text
campusmeet-dev-users
campusmeet-dev-groups
campusmeet-dev-memberships
campusmeet-dev-invitations
campusmeet-dev-meetings
campusmeet-dev-reminders
campusmeet-dev-minutes
campusmeet-dev-tasks
campusmeet-dev-notifications
campusmeet-dev-audit-logs
campusmeet-dev-attachments
campusmeet-dev-recordings
campusmeet-dev-recording-consents
campusmeet-dev-transcripts
campusmeet-dev-ai-jobs
campusmeet-dev-ai-conversations
campusmeet-dev-tool-proposals
```

### Sinh template an toàn

```powershell
npm run infra:prepare:data
```

Lệnh sinh hai file không commit trong `.aws-sam/`:

```text
.aws-sam/data-foundation.generated.json
.aws-sam/data-foundation-import.json
```

Template generated có:

- `DeletionPolicy: Retain`;
- `UpdateReplacePolicy: Retain`;
- dependency tuần tự để tránh tạo đồng thời nhiều bảng có GSI;
- SSE;
- `PAY_PER_REQUEST`;
- tham số PITR và deletion protection;
- outputs cho 17 bảng.

### Validate source/generated/application consistency

```powershell
npm run infra:check
npm run sam:validate:data
```

### Kiểm tra 17 bảng thật

```powershell
npm run aws:verify:data -- -Profile <aws-profile>
```

Script kiểm tra đúng account, Region, inventory, trạng thái `ACTIVE`, billing mode, primary key và GSI.

> Không deploy create trực tiếp vào `campusmeet-dev-*` khi các bảng đã tồn tại. Verify trước, sau đó dùng CloudFormation import hoặc recreate có kế hoạch.

Chi tiết: [docs/huong-dan-data-foundation.md](docs/huong-dan-data-foundation.md).

## Application stack

`infra/template.yaml` nhận:

```text
Environment=dev
DataTablePrefix=campusmeet-dev
```

Stack truyền đủ 17 tên bảng vào Lambda và cấp IAM read/write item đúng prefix/index. Stack không cấp quyền thay đổi schema cho application role.

IAM action hợp lệ cho DynamoDB transaction là quyền của thao tác item tương ứng và `dynamodb:ConditionCheckItem`; không dùng:

```text
dynamodb:TransactGetItems
dynamodb:TransactWriteItems
```

## Bước phát triển tiếp theo

Vertical slice đầu tiên:

```text
Cognito identity
  -> POST /groups
  -> validate input
  -> ghi Groups + Memberships(GROUP_ADMIN)
  -> audit an toàn
  -> GET /groups qua UserMembershipsIndex
  -> test từ chối truy cập chéo nhóm
```

Không triển khai đồng loạt 17 repository trước khi slice này chạy end-to-end.

## Quality gates

```powershell
npm run infra:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run format:check
```

CI không tự deploy AWS. Import/deploy/cleanup cần change set và review thủ công.

## Cấu trúc chính

```text
apps/web/                            React/Vite frontend
services/api/                        Lambda/backend boundaries
packages/shared/                     Shared types/enums/DTO
infra/auth-integration.yaml          Auth integration stack
infra/data-foundation.spec.json      17-table manifest
infra/template.yaml                  Application target stack
scripts/prepare-data-foundation.mjs  Generate template/import map
scripts/validate-infra.mjs           Static consistency checks
scripts/verify-data-foundation.ps1   Read-only AWS verification
docs/                                SRS, architecture, contracts, runbooks
```

## Bảo mật và chi phí

- Không dùng root account.
- Mỗi thành viên dùng IAM user riêng; không chia sẻ password/MFA/access key.
- Không tạo access key nếu chỉ dùng Console.
- Developer không có `CreateTable`, `UpdateTable`, `DeleteTable`, IAM hoặc Billing.
- Không commit token, secret, AWS credential hoặc dữ liệu người dùng.
- PITR, CloudTrail DynamoDB data events, Transcribe, Bedrock, logs và vector storage có thể phát sinh phí.
- Không xóa bảng chỉ để làm deploy chạy.

## Tài liệu

- [Kiến trúc](docs/architecture.md)
- [Data foundation](docs/huong-dan-data-foundation.md)
- [AWS deployment runbook](docs/huong-dan-trien-khai-aws.md)
- [Kế hoạch nhóm](docs/ke-hoach-trien-khai-nhom.md)
- [Kế hoạch M5](docs/ke-hoach-m5-upload-transcript-ai.md)
- [API contract](docs/api-contract.md)
- [SRS](docs/CampusMeet-SRS.md)
