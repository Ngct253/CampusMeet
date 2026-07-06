# CampusMeet

CampusMeet là hệ thống quản lý quy trình **trước, trong và sau cuộc họp** cho nhóm học tập, nhóm đồ án và nhóm dự án nhỏ: tạo nhóm, lập lịch, ghi biên bản, chuyển action item thành task và theo dõi tiến độ. CampusMeet không clone Google Meet; Google Meet chỉ là dịch vụ ngoài hệ thống, dự kiến được tích hợp thông qua Google Calendar API.

## Trạng thái hiện tại

Repository đang ở giai đoạn **scaffold**. Mock data chỉ giúp kiểm tra bố cục và điều hướng, không phải implementation production.

| Thành phần            | Trạng thái hiện tại                                    |
| --------------------- | ------------------------------------------------------ |
| Frontend              | Có application shell, route và mock data               |
| Backend               | Có health endpoint và handler skeleton                 |
| API nghiệp vụ         | Chưa triển khai, hiện có thể trả `501 Not Implemented` |
| Cognito               | Chưa triển khai thật                                   |
| DynamoDB              | Chưa kết nối thật                                      |
| Google OAuth/Calendar | Chưa triển khai thật                                   |
| Reminder              | Chưa chạy thật                                         |
| AWS resources         | Chưa tạo                                               |
| Deploy                | Chưa thực hiện                                         |

## Công nghệ sử dụng

- Frontend: React, TypeScript, Vite, React Router, TanStack Query boundary.
- Backend: Node.js/TypeScript theo cấu trúc AWS Lambda.
- Hạ tầng mục tiêu: AWS SAM, S3, CloudFront, Cognito, API Gateway HTTP API, Lambda, DynamoDB, EventBridge Scheduler, SES, CloudWatch và SNS.

Đây là **target architecture**, không phải mô tả một hệ thống đã deploy.

## Điều kiện cần trước khi chạy

- Node.js 22 LTS, phù hợp runtime `nodejs22.x` trong SAM template.
- npm 10 trở lên.

Không cần AWS account, Google credential hoặc `.env` thật để chạy scaffold hiện tại.

## Clone và chạy local

```bash
git clone <repository-url>
cd CampusMeet
npm install
npm run dev
```

`npm run dev` gọi `npm run dev:web`, khởi động Vite tại `http://localhost:5173`. Frontend luôn dùng mock data ở giai đoạn này; banner **Chế độ dữ liệu mô phỏng** cho biết chưa có API/AWS thật.

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
- **Không có `.env`:** đây không phải lỗi khi đang mock mode. Chỉ tạo file môi trường khi module thật yêu cầu và không commit file đó.
- **AWS/SAM chưa chạy:** scaffold hiện không yêu cầu deploy. Chỉ M5 thực hiện sau khi cả nhóm review điều kiện trong hướng dẫn AWS.

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
- [Kế hoạch triển khai nhóm 5 người](docs/ke-hoach-trien-khai-nhom.md)
- [Hướng dẫn triển khai AWS theo giai đoạn](docs/huong-dan-trien-khai-aws.md)
- [Kiến trúc hệ thống](docs/architecture.md)
- [API contract](docs/api-contract.md)
- [Software Requirements Specification](docs/CampusMeet-SRS.md)

## Cảnh báo bảo mật và chi phí

- Không commit `.env`, token, secret, OAuth credential hoặc AWS credential.
- Không deploy khi chưa được M5 và cả nhóm review; không dùng AWS root account.
- Không chạy lệnh deploy hoặc xóa khi chưa hiểu resource và ảnh hưởng chi phí.
- Repository này chưa tạo bất kỳ AWS resource nào.
