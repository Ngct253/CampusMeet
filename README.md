# CampusMeet

CampusMeet là hệ thống quản lý quy trình **trước, trong và sau cuộc họp** cho nhóm học tập, nhóm đồ án và nhóm dự án nhỏ: tạo nhóm, lập lịch, ghi biên bản, chuyển action item thành task và theo dõi tiến độ. CampusMeet không clone Google Meet; Google Meet là dịch vụ ngoài hệ thống, dự kiến được tích hợp thông qua Google Calendar API và Google Meet REST API khi quyền thực tế cho phép.

## Trạng thái hiện tại

Repository đang chuyển từ scaffold sang tích hợp thật. Đăng ký, xác nhận email, đăng nhập, đăng xuất và route bảo vệ đã được triển khai bằng Amazon Cognito. Hạ tầng dữ liệu dev đã được tạo, nhưng API nghiệp vụ vẫn chưa đọc/ghi DynamoDB thật.

| Thành phần | Trạng thái hiện tại |
| --- | --- |
| Frontend | Có application shell, auth thật khi có env và mock data nghiệp vụ |
| Backend | Có `/health`, `/me` cho auth integration và các handler skeleton |
| API nghiệp vụ | Chưa triển khai; hiện có thể trả `501 Not Implemented` |
| Cognito | Đã triển khai và xác minh; auth integration stack trước đó đã cleanup |
| DynamoDB infrastructure | Đã tạo 17 bảng `campusmeet-dev-*` tại `ap-southeast-1` trong account dev |
| DynamoDB application integration | Chưa triển khai AWS SDK/repository persistence thật |
| IAM team access | Dùng một AWS account, năm IAM user riêng và group `CampusMeetDevelopers` |
| Google OAuth/Calendar/Meet | Chưa triển khai thật |
| Reminder | Chưa chạy thật |
| Frontend hosting/observability | Chưa triển khai full stack |
| Full deployment | Chưa production-ready |

Việc bảng tồn tại trên AWS không đồng nghĩa backend đã kết nối database. Chỉ đánh dấu data layer là “đã tích hợp” sau khi một luồng nghiệp vụ có kiểm tra quyền thực hiện ghi/đọc thật và có test.

## Công nghệ sử dụng

- Frontend: React, TypeScript, Vite, React Router, TanStack Query boundary.
- Backend: Node.js/TypeScript theo cấu trúc AWS Lambda.
- Hạ tầng mục tiêu: AWS SAM, S3, CloudFront, Cognito, API Gateway HTTP API, Lambda, DynamoDB, EventBridge Scheduler, SES, CloudWatch và SNS.
- AI mục tiêu: S3 user-content, Step Functions, Amazon Transcribe, Amazon Bedrock, Bedrock Knowledge Bases và S3 Vectors.

Đây là **target architecture**, không phải mô tả một hệ thống đã triển khai hoàn chỉnh.

## Điều kiện cần trước khi chạy

- Node.js 22 LTS, phù hợp runtime `nodejs22.x` trong SAM template.
- npm 10 trở lên.
- AWS CLI và AWS SAM CLI khi cần validate, kiểm tra hoặc triển khai tài nguyên AWS.
- Quyền AWS tối thiểu phù hợp; không dùng root account.

Không cần Google credential cho auth hiện tại.

## Clone và chạy local

```bash
git clone <repository-url>
cd CampusMeet
npm install
npm run dev
```

`npm run dev` gọi `npm run dev:web`, khởi động Vite tại `http://localhost:5173`. Nếu chưa cấu hình Cognito, frontend hiển thị thông báo chưa kết nối AWS; dữ liệu nghiệp vụ vẫn là mock.

## Source of truth hạ tầng AWS

Hạ tầng được tách theo phạm vi để tránh tạo tài nguyên trùng:

| File | Phạm vi |
| --- | --- |
| `infra/auth-integration.yaml` | Cognito, HTTP API và Lambda tối thiểu để kiểm tra auth |
| `infra/data-foundation.yaml` | 17 bảng DynamoDB theo miền nghiệp vụ |
| `infra/template.yaml` | Application stack mục tiêu; dùng các bảng có sẵn qua `DataTablePrefix` |

`infra/template.yaml` không còn tạo bốn bảng placeholder. Application stack mặc định trỏ tới prefix `campusmeet-dev`.

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

Chi tiết key/index, quy tắc import và IAM nằm trong [Hướng dẫn DynamoDB data foundation](docs/huong-dan-data-foundation.md).

### Kiểm tra 17 bảng đang tồn tại

Chạy trong PowerShell:

```powershell
.\scripts\verify-data-foundation.ps1 `
  -Profile <aws-profile> `
  -Region ap-southeast-1 `
  -Environment dev
```

Script kiểm tra đúng account `604360241374`, đủ 17 bảng, trạng thái `ACTIVE`, billing `PAY_PER_REQUEST`, key schema và GSI theo IaC.

> Không deploy `infra/data-foundation.yaml` thẳng vào dev khi 17 bảng cùng tên đang tồn tại. Trước tiên phải chạy script kiểm tra và thực hiện CloudFormation resource import hoặc chủ động recreate theo runbook đã review.

## Cấu hình đăng ký và đăng nhập

Một thành viên phụ trách AWS deploy stack auth; các thành viên còn lại chỉ dùng ba output công khai trong `.env.local`. Không chia sẻ AWS credential, token hoặc mật khẩu.

### 1. Deploy auth integration

Đăng nhập AWS, xác nhận đúng account/Region, sau đó validate và build:

```powershell
aws login --profile <aws-profile> --region <aws-region>
aws sts get-caller-identity --profile <aws-profile>

sam validate --template-file infra/auth-integration.yaml --lint --profile <aws-profile> --region <aws-region>
npm run sam:build:auth
```

Preview change set trước khi tạo tài nguyên:

```powershell
sam deploy `
  --template-file infra/auth-integration.yaml `
  --stack-name <stack-name> `
  --resolve-s3 `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides AllowedOrigin=http://localhost:5173 `
  --no-execute-changeset `
  --profile <aws-profile> `
  --region <aws-region>
```

Review rồi execute change set theo [hướng dẫn cấu hình đăng nhập](docs/huong-dan-cau-hinh-dang-nhap.md). Sau khi stack hoàn thành, lấy ba output:

```powershell
aws cloudformation describe-stacks `
  --stack-name <stack-name> `
  --query "Stacks[0].Outputs" `
  --profile <aws-profile> `
  --region <aws-region>
```

### 2. Cấu hình frontend

Tạo `apps/web/.env.local` từ `apps/web/.env.example` và điền output tương ứng:

```dotenv
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_USER_POOL_CLIENT_ID=<UserPoolClientId>
VITE_API_BASE_URL=<ApiUrl>
```

Ba giá trị này là cấu hình public của frontend, không phải secret. Không commit `.env.local`. Khởi động lại Vite sau mỗi lần sửa env:

```powershell
npm run dev
```

### 3. Kiểm tra luồng auth

1. Mở `http://localhost:5173/sign-up`, đăng ký bằng email có thể nhận mã.
2. Nhập mã Cognito gửi qua email để xác nhận tài khoản.
3. Đăng nhập tại `/sign-in`; ứng dụng phải chuyển vào route được bảo vệ.
4. Đăng xuất; route được bảo vệ phải chuyển lại về trang đăng nhập.
5. `/health` phải trả `200`; `/me` không có Bearer token phải trả `401`.

Password hiện cần tối thiểu 8 ký tự, gồm chữ thường, chữ hoa, số và ký tự đặc biệt.

## Bước phát triển tiếp theo

Vertical slice đầu tiên của data layer:

```text
Cognito identity
  -> POST /groups
  -> kiểm tra input
  -> ghi Groups
  -> ghi Memberships với role GROUP_ADMIN
  -> đọc lại group theo quyền thành viên
  -> audit an toàn
```

Không triển khai đồng loạt 17 repository trước khi slice tạo nhóm chạy end-to-end. Mỗi thao tác group-scoped phải kiểm tra membership/role ở backend.

## Kiểm tra chất lượng

| Lệnh | Mục đích |
| --- | --- |
| `npm run lint` | Kiểm tra quy tắc ESLint toàn monorepo |
| `npm run typecheck` | Chạy TypeScript strict check cho các workspace |
| `npm run test` | Chạy smoke tests bằng Vitest |
| `npm run build` | Compile shared/API và tạo frontend production bundle |
| `npm run format` | Format file bằng Prettier |
| `npm run format:check` | Kiểm tra format mà không sửa file |
| `npm run sam:validate:data` | Validate `infra/data-foundation.yaml` |
| `npm run aws:verify:data -- -Profile <profile>` | Kiểm tra 17 bảng DynamoDB dev |

Trước Pull Request, chạy ít nhất `lint`, `typecheck`, `test`, `build` và `format:check`. PR thay đổi data/IAM phải kèm kết quả verify hoặc change-set review.

## Lỗi thường gặp

- **`npm install` lỗi chứng thư hoặc mạng:** kiểm tra proxy/CA của trường hoặc công ty; không tắt `strict-ssl`.
- **Node/npm không phù hợp:** kiểm tra bằng `node --version` và `npm --version`, ưu tiên Node.js 22 LTS.
- **Port 5173 đang được dùng:** dừng process cũ hoặc chạy `npm run dev:web -- --port 5174`.
- **Không có `.env.local`:** giao diện vẫn chạy nhưng auth thật bị vô hiệu hóa.
- **Sửa `.env.local` nhưng auth chưa hoạt động:** restart Vite và kiểm tra đúng ba tên biến.
- **`Resource already exists` khi deploy data foundation:** 17 bảng dev đã tồn tại; dừng deploy và làm theo quy trình verify/import.
- **Script báo `DRIFT`:** key/index trên AWS khác IaC; không tự sửa hoặc xóa bảng, lưu output và review migration.
- **DynamoDB có bảng nhưng API vẫn trả `501`:** đây là trạng thái hiện tại; repository/handler nghiệp vụ chưa được implement.

## Cấu trúc repository

```text
apps/web/                          React/Vite application shell và mock UI
services/api/                      Lambda handlers, domain ports và adapter placeholders
packages/shared/                   Types, enums, DTO dùng chung
infra/auth-integration.yaml        Auth integration stack
infra/data-foundation.yaml         Source of truth cho 17 bảng DynamoDB
infra/template.yaml                Application stack dùng data table prefix
scripts/verify-data-foundation.ps1 Kiểm tra drift của 17 bảng AWS
docs/                              SRS, kiến trúc và runbook
.github/                           CI quality gates
```

Đọc bản đồ chi tiết tại [Hướng dẫn cấu trúc repository](docs/huong-dan-cau-truc-repository.md).

## Tài liệu nhóm

- [Hướng dẫn DynamoDB data foundation](docs/huong-dan-data-foundation.md)
- [Hướng dẫn cấu trúc repository](docs/huong-dan-cau-truc-repository.md)
- [Hướng dẫn cấu hình đăng ký và đăng nhập](docs/huong-dan-cau-hinh-dang-nhap.md)
- [Kế hoạch triển khai nhóm 5 người](docs/ke-hoach-trien-khai-nhom.md)
- [Hướng dẫn triển khai AWS theo giai đoạn](docs/huong-dan-trien-khai-aws.md)
- [Kiến trúc hệ thống](docs/architecture.md)
- [API contract](docs/api-contract.md)
- [Software Requirements Specification](docs/CampusMeet-SRS.md)

## Cảnh báo bảo mật và chi phí

- Không commit `.env`, token, secret, OAuth credential hoặc AWS credential.
- Không chia sẻ IAM user, password, MFA hoặc access key giữa các thành viên.
- Không tạo access key nếu chỉ dùng AWS Console.
- Không dùng AWS root account.
- Không cấp `CreateTable`, `UpdateTable`, `DeleteTable`, IAM hoặc Billing cho group developer.
- Không deploy hoặc import khi chưa review change set, key/index, retention và cleanup.
- PITR/deletion protection đang để tham số và không tự bật cho dev; review chi phí trước khi đổi.
- CloudTrail DynamoDB data events không bật mặc định và có thể phát sinh phí.
