# CampusMeet

CampusMeet là hệ thống quản lý quy trình **trước, trong và sau cuộc họp** cho nhóm học tập, nhóm đồ án và nhóm dự án nhỏ: tạo nhóm, lập lịch, ghi biên bản, chuyển action item thành task và theo dõi tiến độ. CampusMeet không clone Google Meet; Google Meet chỉ là dịch vụ ngoài hệ thống, dự kiến được tích hợp thông qua Google Calendar API.

## Trạng thái hiện tại

Repository đang chuyển từ **scaffold** sang tích hợp thật. Đăng ký, xác nhận email, đăng nhập, đăng xuất và route bảo vệ đã được triển khai bằng Amazon Cognito; các chức năng nghiệp vụ vẫn dùng mock hoặc handler skeleton.

| Thành phần            | Trạng thái hiện tại                                                   |
| --------------------- | --------------------------------------------------------------------- |
| Frontend              | Có application shell, auth thật khi có env và mock data nghiệp vụ     |
| Backend               | Có `/health`, `/me` cho auth integration và các handler skeleton      |
| API nghiệp vụ         | Chưa triển khai, hiện có thể trả `501 Not Implemented`                |
| Cognito               | Đã triển khai và xác minh; cần deploy stack riêng cho môi trường nhóm |
| DynamoDB              | Chưa kết nối thật                                                     |
| Google OAuth/Calendar | Chưa triển khai thật                                                  |
| Reminder              | Chưa chạy thật                                                        |
| AWS resources         | Không có stack đang hoạt động sau lần kiểm thử/cleanup                |
| Deploy                | Auth integration đã deploy thử, smoke test và xóa thành công          |

## Công nghệ sử dụng

- Frontend: React, TypeScript, Vite, React Router, TanStack Query boundary.
- Backend: Node.js/TypeScript theo cấu trúc AWS Lambda.
- Hạ tầng mục tiêu: AWS SAM, S3, CloudFront, Cognito, API Gateway HTTP API, Lambda, DynamoDB, EventBridge Scheduler, SES, CloudWatch và SNS.

Đây là **target architecture**, không phải mô tả một hệ thống đã deploy.

## Điều kiện cần trước khi chạy

- Node.js 22 LTS, phù hợp runtime `nodejs22.x` trong SAM template.
- npm 10 trở lên.

Chỉ cần AWS CLI, AWS SAM CLI và quyền AWS phù hợp khi muốn chạy đăng nhập thật. Không cần Google credential cho auth hiện tại.

## Clone và chạy local

```bash
git clone <repository-url>
cd CampusMeet
npm install
npm run dev
```

`npm run dev` gọi `npm run dev:web`, khởi động Vite tại `http://localhost:5173`. Nếu chưa cấu hình Cognito, frontend hiển thị thông báo chưa kết nối AWS; dữ liệu nghiệp vụ vẫn là mock.

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

Password hiện cần tối thiểu 8 ký tự, gồm chữ thường, chữ hoa, số và ký tự đặc biệt. Chi tiết deploy, smoke test, lỗi thường gặp và cleanup nằm trong [Hướng dẫn triển khai AWS theo giai đoạn](docs/huong-dan-trien-khai-aws.md).

Cách lấy riêng từng ID bằng CLI/AWS Console, ánh xạ output và xử lý lỗi CORS/API URL được ghi đầy đủ trong [Hướng dẫn cấu hình đăng ký và đăng nhập](docs/huong-dan-cau-hinh-dang-nhap.md).

## Kiểm tra chất lượng

| Lệnh                   | Mục đích                                             |
| ---------------------- | ---------------------------------------------------- |
| `npm run lint`         | Kiểm tra quy tắc ESLint toàn monorepo                |
| `npm run typecheck`    | Chạy TypeScript strict check cho các workspace       |
| `npm run test`         | Chạy smoke tests bằng Vitest                         |
| `npm run build`        | Compile shared/API và tạo frontend production bundle |
| `npm run format`       | Format file bằng Prettier                            |
| `npm run format:check` | Kiểm tra format mà không sửa file                    |

Trước Pull Request, chạy ít nhất `lint`, `typecheck`, `test` và `build`.

## Lỗi thường gặp

- **`npm install` lỗi chứng thư hoặc mạng:** kiểm tra proxy/CA của trường hoặc công ty; không tắt `strict-ssl`. Trên Node mới có thể thử dùng system CA theo chính sách máy.
- **Node/npm không phù hợp:** kiểm tra bằng `node --version` và `npm --version`, ưu tiên Node.js 22 LTS.
- **Port 5173 đang được dùng:** dừng process cũ hoặc chạy `npm run dev:web -- --port 5174`.
- **Build/typecheck lỗi sau khi pull:** chạy lại `npm install`, sau đó `npm run typecheck` để tìm contract/import đã thay đổi.
- **Không có `.env.local`:** giao diện vẫn chạy nhưng auth thật bị vô hiệu hóa; tạo file theo mục cấu hình đăng nhập và không commit file đó.
- **Sửa `.env.local` nhưng auth chưa hoạt động:** restart Vite và kiểm tra ba tên biến khớp chính xác với `apps/web/.env.example`.
- **AWS/SAM chưa chạy:** chỉ cần deploy khi nhóm muốn dùng auth thật; một người quản lý stack để tránh tạo tài nguyên trùng.

## Cấu trúc repository

```text
apps/web/          React/Vite application shell và mock UI
services/api/      Lambda handlers, ports và adapter placeholders
packages/shared/   Types, enums, DTO dùng chung
infra/             AWS SAM source of truth
docs/              SRS và tài liệu làm việc của nhóm
.github/           CI quality gates
```

Đọc bản đồ chi tiết tại [Hướng dẫn cấu trúc repository](docs/huong-dan-cau-truc-repository.md).

## Tài liệu nhóm

- [Hướng dẫn cấu trúc repository](docs/huong-dan-cau-truc-repository.md)
- [Hướng dẫn cấu hình đăng ký và đăng nhập](docs/huong-dan-cau-hinh-dang-nhap.md)
- [Kế hoạch triển khai nhóm 5 người](docs/ke-hoach-trien-khai-nhom.md)
- [Hướng dẫn triển khai AWS theo giai đoạn](docs/huong-dan-trien-khai-aws.md)
- [Kiến trúc hệ thống](docs/architecture.md)
- [API contract](docs/api-contract.md)
- [Software Requirements Specification](docs/CampusMeet-SRS.md)

## Cảnh báo bảo mật và chi phí

- Không commit `.env`, token, secret, OAuth credential hoặc AWS credential.
- Không deploy khi chưa được M5 và cả nhóm review; không dùng AWS root account.
- Không chạy lệnh deploy hoặc xóa khi chưa hiểu resource và ảnh hưởng chi phí.
- Stack auth từng được tạo để xác minh và đã cleanup; kiểm tra CloudFormation trước khi tạo stack mới.
