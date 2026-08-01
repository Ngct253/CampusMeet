# Hướng dẫn cấu hình đăng ký và đăng nhập

Tài liệu này cấu hình frontend React dùng Amazon Cognito từ stack `infra/auth-integration.yaml`. Stack dùng API Gateway stage `$default`, vì vậy `ApiUrl` **không có** hậu tố `/dev`.

## 1. Điều kiện

- Node.js 22 LTS và npm 10+.
- AWS CLI và AWS SAM CLI.
- Một AWS profile có quyền tạo CloudFormation, Cognito, API Gateway, Lambda, IAM role và CloudWatch Log Group.
- Cả nhóm thống nhất một AWS account, Region, stack name và một người chịu trách nhiệm deploy.

Không dùng AWS root account. Không gửi AWS credential, password, token hoặc mã xác nhận qua Git/GitHub.

## 2. Deploy stack auth

Từ thư mục gốc repository:

```powershell
aws login --profile <aws-profile> --region <aws-region>
aws sts get-caller-identity --profile <aws-profile>

npm ci
sam validate `
  --template-file infra/auth-integration.yaml `
  --lint `
  --profile <aws-profile> `
  --region <aws-region>
npm run sam:build:auth
```

Tạo change set để review trước:

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

Sau khi review resource và IAM, execute change set theo [hướng dẫn triển khai AWS](huong-dan-trien-khai-aws.md).

## 3. Lấy đầy đủ ID bằng AWS CLI

Xem toàn bộ output:

```powershell
aws cloudformation describe-stacks `
  --stack-name <stack-name> `
  --query "Stacks[0].Outputs" `
  --output table `
  --profile <aws-profile> `
  --region <aws-region>
```

Lấy riêng từng giá trị để tránh chép nhầm:

```powershell
aws cloudformation describe-stacks `
  --stack-name <stack-name> `
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue | [0]" `
  --output text `
  --profile <aws-profile> `
  --region <aws-region>

aws cloudformation describe-stacks `
  --stack-name <stack-name> `
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue | [0]" `
  --output text `
  --profile <aws-profile> `
  --region <aws-region>

aws cloudformation describe-stacks `
  --stack-name <stack-name> `
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue | [0]" `
  --output text `
  --profile <aws-profile> `
  --region <aws-region>
```

Ánh xạ output sang frontend:

| CloudFormation output | Biến frontend                      | Hình dạng ví dụ                                        |
| --------------------- | ---------------------------------- | ------------------------------------------------------ |
| `UserPoolId`          | `VITE_COGNITO_USER_POOL_ID`        | `ap-southeast-1_AbCdEf123`                             |
| `UserPoolClientId`    | `VITE_COGNITO_USER_POOL_CLIENT_ID` | Chuỗi chữ và số, không phải client secret              |
| `ApiUrl`              | `VITE_API_BASE_URL`                | `https://abc.execute-api.ap-southeast-1.amazonaws.com` |

Không dùng User Pool ARN thay cho User Pool ID. Không dùng Lambda URL hoặc CloudFormation stack ID thay cho `ApiUrl`.

## 4. Lấy ID bằng AWS Console

Nếu không dùng CLI:

1. Mở **AWS Console → CloudFormation → Stacks**.
2. Chọn đúng Region và `<stack-name>`.
3. Mở tab **Outputs**.
4. Sao chép đúng ba key: `UserPoolId`, `UserPoolClientId`, `ApiUrl`.

Có thể đối chiếu Cognito:

1. Mở **Amazon Cognito → User pools**.
2. Chọn pool có tên `<stack-name>-users`.
3. User Pool ID nằm ở trang tổng quan.
4. Mở **App integration → App clients**, chọn `<stack-name>-web`.
5. Sao chép Client ID; stack này đặt `GenerateSecret: false`, nên frontend không cần và không được chứa client secret.

## 5. Tạo cấu hình frontend

Trong `apps/web`, sao chép `.env.example` thành `.env`, rồi điền giá trị thật:

```dotenv
VITE_COGNITO_USER_POOL_ID=ap-southeast-1_AbCdEf123
VITE_COGNITO_USER_POOL_CLIENT_ID=<UserPoolClientId>
VITE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com
```

Quy tắc:

- Không thêm dấu nháy nếu giá trị không chứa khoảng trắng.
- Không thêm `/dev` khi dùng `infra/auth-integration.yaml`.
- Không thêm dấu `/` cuối `VITE_API_BASE_URL`.
- `.env` đã được `.gitignore`; không dùng `git add -f`.
- `VITE_*` là cấu hình public được đóng vào frontend, tuyệt đối không đặt password, token hoặc AWS credential ở đây.
- Restart `npm run dev` sau khi sửa `.env`.

## 6. Chạy và kiểm tra

```powershell
npm install
npm run dev
```

Kiểm tra theo thứ tự:

1. Mở `http://localhost:5173/sign-up`.
2. Đăng ký bằng email có thể nhận mã.
3. Mở `/confirm-sign-up` và nhập mã Cognito gửi qua email.
4. Đăng nhập tại `/sign-in`.
5. Xác nhận truy cập được `/app`.
6. Đăng xuất và xác nhận `/app` chuyển về `/sign-in`.

Kiểm tra API:

```powershell
curl.exe -i "<ApiUrl>/health"
curl.exe -i "<ApiUrl>/me"
```

Kỳ vọng `/health` trả `200`; `/me` không có token trả `401`. Frontend tự quản lý phiên Cognito; không chép token vào tài liệu hoặc issue.

## 7. File liên quan

| File                                   | Vai trò                                                |
| -------------------------------------- | ------------------------------------------------------ |
| `infra/auth-integration.yaml`          | Cognito, API Gateway, Lambda và CloudFormation outputs |
| `apps/web/.env.example`                | Tên biến frontend và placeholder an toàn               |
| `apps/web/src/config/environment.ts`   | Đọc biến môi trường                                    |
| `apps/web/src/config/amplify.ts`       | Cấu hình Amplify Auth                                  |
| `apps/web/src/auth/AuthProvider.tsx`   | Trạng thái phiên và đăng xuất                          |
| `apps/web/src/auth/RequireAuth.tsx`    | Bảo vệ route                                           |
| `apps/web/src/pages/PublicPages.tsx`   | Đăng ký, xác nhận, đăng nhập và quên mật khẩu          |
| `services/api/src/auth-integration.ts` | `/health` và `/me` cho stack auth                      |

## 8. Lỗi thường gặp

| Lỗi                                        | Kiểm tra                                                            |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Frontend báo chưa kết nối AWS              | Đúng tên file `apps/web/.env`, đủ hai Cognito ID và đã restart Vite |
| Cognito báo user pool/client không tồn tại | ID phải cùng Region và cùng stack; stack chưa bị xóa                |
| Đăng ký được nhưng không nhận email        | Kiểm tra spam, email nhập đúng và trạng thái user trong Cognito     |
| `/me` trả `401` không token                | Đúng hành vi; endpoint này được JWT authorizer bảo vệ               |
| Browser báo CORS                           | `AllowedOrigin` phải đúng origin, gồm cả port và không có path      |
| API trả 404 khi URL có `/dev`              | Xóa `/dev`; auth integration dùng stage `$default`                  |

Khi kết thúc môi trường thử nghiệm, người quản lý stack thực hiện cleanup theo [hướng dẫn triển khai AWS](huong-dan-trien-khai-aws.md).
