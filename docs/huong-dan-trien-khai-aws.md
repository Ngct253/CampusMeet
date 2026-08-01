# Runbook triển khai lại CampusMeet: IAM, 5 bảng và đăng nhập

Tài liệu này là luồng duy nhất để dựng môi trường AWS dev dùng chung từ đầu: tạo quyền cho thành viên, deploy 5 bảng DynamoDB, deploy Cognito/API M1, cấu hình frontend và kiểm tra đăng ký/đăng nhập. Không coi template tồn tại hoặc build thành công là bằng chứng đã deploy.

## 1. Kết quả sau khi hoàn thành

| Thành phần     | Kết quả cần có                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| Thành viên AWS | Mỗi người dùng IAM user riêng và đăng nhập CLI bằng `aws login`                |
| DynamoDB       | Đúng 5 bảng `campusmeet-dev-*`, `PAY_PER_REQUEST`, TTL/GSI đúng contract       |
| API M1         | Cognito, Lambda và HTTP API cho hồ sơ, nhóm, lời mời và thông báo đã hoạt động |
| Frontend local | `apps/web/.env` lấy đúng ba output CloudFormation                              |
| Kiểm tra cuối  | Đăng ký, nhận mã, xác nhận, đăng nhập, mở `/app` và đăng xuất thành công       |

Source of truth data model: [Mô hình dữ liệu DynamoDB](dynamodb-data-model.md).

## 2. Stack boundary

CampusMeet tách stack để giảm blast radius:

| Template                      | Vai trò                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `infra/auth-integration.yaml` | Cognito + API/Lambda cho toàn bộ vertical slice M1                                                    |
| `infra/data-foundation.yaml`  | 5 bảng DynamoDB dùng chung                                                                            |
| `infra/template.yaml`         | Application stack: frontend/API/reminder/Cognito và hạ tầng AI; tham chiếu bảng qua `DataTablePrefix` |

`infra/template.yaml` không tạo lại bảng. Data stack phải tồn tại trước application stack.

Thứ tự bắt buộc:

```text
IAM user/CLI → data stack → verify 5 bảng → auth stack → lấy outputs → .env → smoke test login
```

`infra/template.yaml` chưa production-ready và không nằm trong lần dựng nền tảng này.

## 3. Điều kiện trước

- Cả nhóm đã chốt một AWS account dev và ghi lại Account ID của tài khoản đó.
- Region: `ap-southeast-1`.
- AWS CLI `2.32.0` trở lên và AWS SAM CLI đã cài.
- Node.js 22 LTS và npm 10+.
- Mỗi người dùng IAM user riêng; không dùng root hằng ngày và không tạo/chia sẻ access key dài hạn.
- Một người giữ vai trò deployment owner vì auth template tạo IAM execution role.
- Budget alert đã cấu hình.

Mỗi thành viên đăng nhập bằng credential Console của chính mình:

```powershell
aws login
aws sts get-caller-identity
```

Nếu máy có nhiều tài khoản AWS, dùng profile riêng trong cả hai lệnh. Các lệnh còn lại trong runbook dùng profile mặc định.

Ghi Account ID để dùng khi verify:

```powershell
$AccountId = aws sts get-caller-identity --query Account --output text
$AccountId
```

Không tiếp tục nếu Account ID hoặc Region không đúng môi trường nhóm đã chốt.

## 4. Cấp quyền IAM cho thành viên

Deployment owner thực hiện một lần trong AWS Console:

1. Nếu account chưa có deployment owner, root chỉ dùng một lần để tạo `campusmeet-admin`, cấp Console access và `AdministratorAccess`, sau đó đăng xuất root. Không tạo thêm admin nếu account đã có owner tương đương.
2. Mở **IAM → User groups → Create group** và tạo `CampusMeetDevelopers` nếu chưa có.
3. Gắn `SignInLocalDevelopmentAccess` để thành viên dùng `aws login` với credential tạm thời.
4. Nếu đây là account dev chỉ dành cho CampusMeet và nhóm cần thao tác các dịch vụ AWS, gắn `PowerUserAccess`. Policy này không cho quản lý IAM user/group.
5. Tạo một IAM user cho từng người, bật Console access, yêu cầu đổi mật khẩu lần đầu và thêm vào `CampusMeetDevelopers`.
6. Gửi sign-in URL, IAM username và mật khẩu tạm qua kênh riêng; không đưa vào Git hoặc nhóm chat công khai.
7. Không tạo access key cho người dùng con người.

`PowerUserAccess` vẫn không cho tạo IAM role hoặc `iam:PassRole`. Vì `infra/auth-integration.yaml` tạo execution role, chỉ deployment owner có quyền IAM phù hợp mới deploy auth stack. Thành viên khác phát triển tính năng, đọc logs và dùng tài nguyên dev qua quyền nhóm; không tự deploy chồng stack dùng chung.

Mỗi thành viên xác minh CLI:

```powershell
aws --version
aws login
aws sts get-caller-identity
```

Kết quả phải xác định đúng IAM user/session của người đang đăng nhập và `Account` phải bằng `$AccountId` mà nhóm đã chốt.

## 5. Validate data foundation

```powershell
sam validate `
  --template-file infra/data-foundation.yaml `
  --lint `
  --region ap-southeast-1
```

Hoặc:

```powershell
npm run sam:validate:data -- --region ap-southeast-1
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

## 6. Preview data change set

```powershell
sam deploy `
  --template-file infra/data-foundation.yaml `
  --stack-name campusmeet-dev-data `
  --resolve-s3 `
  --parameter-overrides `
    Environment=dev `
    TablePrefix=campusmeet-dev `
    EnablePointInTimeRecovery=false `
    EnableDeletionProtection=false `
  --no-execute-changeset `
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
  --stack-name campusmeet-dev-data `
  --resolve-s3 `
  --parameter-overrides `
    Environment=dev `
    TablePrefix=campusmeet-dev `
    EnablePointInTimeRecovery=false `
    EnableDeletionProtection=false `
  --region ap-southeast-1
```

Không đóng terminal khi chưa đọc kết quả. Nếu stack thất bại, đọc Events trước khi retry.

## 8. Verify 5 bảng

```powershell
powershell -NoProfile -File scripts/verify-data-foundation.ps1 `
  -Region ap-southeast-1 `
  -TablePrefix campusmeet-dev `
  -ExpectedAccountId $AccountId
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
  --stack-name campusmeet-dev-data `
  --query "Stacks[0].Outputs" `
  --region ap-southeast-1
```

Lưu bằng chứng outputs trong ticket/PR; không hard-code ARN/account ID vào source.

## 9. Deploy Cognito và API đăng nhập

Deployment owner chạy từ thư mục gốc repository:

```powershell
npm ci

sam validate `
  --template-file infra/auth-integration.yaml `
  --lint `
  --region ap-southeast-1

npm run sam:build:auth
```

Tạo change set để kiểm tra trước:

```powershell
sam deploy `
  --template-file infra/auth-integration.yaml `
  --stack-name campusmeet-dev-auth `
  --resolve-s3 `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides AllowedOrigin=http://localhost:5173 DataTablePrefix=campusmeet-dev `
  --no-execute-changeset `
  --region ap-southeast-1
```

Change set chỉ được tạo các thành phần của stack auth: Cognito User Pool/client, HTTP API, Lambda, execution role và log group. Sau khi review, execute change set trong CloudFormation Console hoặc chạy lại lệnh trên và bỏ `--no-execute-changeset`.

Đọc ba output public:

```powershell
aws cloudformation describe-stacks `
  --stack-name campusmeet-dev-auth `
  --query "Stacks[0].Outputs" `
  --output table `
  --region ap-southeast-1
```

Kết quả phải có `UserPoolId`, `UserPoolClientId` và `ApiUrl`. Không dùng User Pool ARN, Lambda URL hoặc CloudFormation stack ID thay cho các giá trị này.

### 9.1. Cập nhật AWS của M1 ngày 01/08/2026

Stack `campusmeet-dev-auth` tại `ap-southeast-1` đã được cập nhật tại chỗ. CloudFormation chỉ sửa Lambda `AuthIntegrationFunction` và HTTP API hiện có, không tạo bảng, Cognito User Pool, IAM role hoặc tài nguyên thay thế mới.

Các route M1 hiện nằm trong Lambda này:

- hồ sơ: `/me`;
- nhóm, thành viên và lời mời do quản trị viên tạo: `/groups/*`;
- hộp thư lời mời: `GET /invitations`;
- phản hồi trong ứng dụng: `POST /invitations/by-id/:invitationId/accept|decline`;
- liên kết mời dự phòng: `/invitations/:token/*`;
- thông báo: `/notifications/*`.

Notification lời mời mở đúng `/app/invitations?invitationId=<invitationId>`; token thô không nằm trong notification. Khi đọc dữ liệu notification cũ, API cũng suy ra URL từ ID để không thể dùng notification cũ chấp nhận một lời mời mới. Source of truth là `infra/auth-integration.yaml`, `services/api/src/auth-integration.ts` và [API contract](api-contract.md).

Khi người nhận chấp nhận hoặc từ chối lời mời, Lambda tự đánh dấu notification `invitation-<invitationId>` là đã đọc. Đây là thay đổi mã trong Lambda hiện có, không cần thêm bảng, index, route API hoặc IAM permission.

API từ chối xóa mọi membership có vai trò `GROUP_ADMIN`; giao diện chỉ hiện thao tác xóa cho `MEMBER`. Hai thay đổi trên chỉ cập nhật Lambda/API hiện có, không tạo tài nguyên AWS, bảng, index hay quyền IAM mới.

### 9.2. Chuyển sang AWS account khác

Tài nguyên không tự chuyển giữa hai account. Deployment owner thực hiện theo thứ tự:

1. Kiểm tra Account ID và Region của profile mới bằng `aws sts get-caller-identity` và `aws configure get region`.
2. Deploy stack 5 bảng với tên `campusmeet-dev-data`, sau đó verify đủ 5 bảng.
3. Deploy `campusmeet-dev-auth` từ source hiện tại với `DataTablePrefix=campusmeet-dev`; bước này dựng lại toàn bộ route M1 ở trên.
4. Lấy `UserPoolId`, `UserPoolClientId`, `ApiUrl` mới và cập nhật `apps/web/.env` trên máy của từng thành viên.
5. Cognito user và dữ liệu DynamoDB của account cũ không tự xuất hiện ở account mới. Với môi trường dev chưa cần giữ dữ liệu, người dùng đăng ký lại; nếu cần giữ dữ liệu phải chốt phương án export/import trước khi xóa.
6. Chỉ dọn tài nguyên account cũ sau khi đăng ký, nhóm và lời mời hoạt động trên account mới. Bảng có `DeletionPolicy: Retain` vẫn có thể phát sinh chi phí sau khi xóa stack và phải được kiểm tra riêng.

## 10. Cấu hình frontend cho cả nhóm

Mỗi thành viên tạo `apps/web/.env` từ `apps/web/.env.example` và điền output của cùng stack:

```dotenv
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_USER_POOL_CLIENT_ID=<UserPoolClientId>
VITE_API_BASE_URL=<ApiUrl>
```

Quy tắc:

- không commit `.env`;
- không thêm `/dev` vào `ApiUrl` vì auth stack dùng stage `$default`;
- không thêm dấu `/` cuối URL;
- `VITE_*` là public client config, không đặt password, access key hoặc token vào đây;
- khi auth stack được dựng lại, cả nhóm phải cập nhật lại ba giá trị vì ID/URL có thể đổi.

Chi tiết lấy từng output bằng CLI/Console và xử lý lỗi nằm trong [Hướng dẫn cấu hình đăng nhập](huong-dan-cau-hinh-dang-nhap.md).

## 11. Kiểm tra đăng ký và đăng nhập

```powershell
npm run dev
```

Kiểm tra theo đúng thứ tự:

1. Mở `http://localhost:5173/sign-up` và đăng ký bằng email thật.
2. Xác nhận Cognito gửi mã; kiểm tra spam nếu chưa thấy email.
3. Nhập mã tại `/confirm-sign-up` và xác nhận user chuyển sang `CONFIRMED` trong Cognito Console.
4. Đăng nhập tại `/sign-in` và mở được `/app`.
5. Đóng/mở lại trình duyệt và xác nhận phiên vẫn được khôi phục.
6. Đăng xuất và xác nhận `/app` chuyển về `/sign-in`.

Kiểm tra API public:

```powershell
curl.exe -i "<ApiUrl>/health"
curl.exe -i "<ApiUrl>/me"
```

`/health` phải trả `200`; `/me` không có token phải trả `401`. Frontend tự gửi access token khi gọi API thật, không chép token vào terminal history, tài liệu hoặc issue.

## 12. Application stack và persistence tiếp theo

`infra/template.yaml` nhận `Environment=dev` và `DataTablePrefix=campusmeet-dev`, rồi truyền năm biến môi trường bảng vào Lambda. Chỉ validate ở giai đoạn nền tảng:

```powershell
sam validate `
  --template-file infra/template.yaml `
  --lint `
  --region ap-southeast-1
```

Chưa deploy application stack cho tới khi repository thật, authorization và integration test của vertical slice cần triển khai đã hoàn thiện. Không deploy application stack chỉ vì data/auth stack đã thành công.

## 13. Rollback khi deploy lỗi

1. Đọc **CloudFormation → stack → Events** và lỗi đầu tiên trước khi retry.
2. Không tạo bảng, User Pool hoặc API thay thế thủ công trong Console.
3. Data tables có `Retain`; không giả định xóa stack sẽ xóa bảng.
4. Auth stack phải được sửa trong template và deploy lại, không sửa cấu hình production bằng tay.
5. Sau rollback, chạy lại verify 5 bảng và smoke test đăng nhập.

## 14. Hạ tầng upload/live transcript/AI

Không cấp `s3:*`, `transcribe:*` hoặc `bedrock:*` rộng cho API Lambda.

- API Lambda: authorization, presign, complete verification, AIJob control.
- Step Functions role: điều phối đúng state machine/service.
- AI Worker role: đọc đúng S3 prefix, cập nhật `ai-work`, gọi provider được cấp.
- Knowledge Base role: đọc data-source prefix và dùng đúng vector store.
- Binary không đi qua API Gateway payload.
- Partial transcript không persist/ingest.
- Log không chứa audio, transcript, prompt, presigned URL hoặc model response nhạy cảm.

Chi tiết: [Thiết kế kỹ thuật upload/live transcript/AI](thiet-ke-ky-thuat-upload-live-transcript-ai.md).

## 15. Chi phí

- On-demand vẫn tính phí request/storage/index/backup.
- GSI nhân thêm write/storage cho item có index key.
- PITR, backup, S3 export/import, CloudWatch logs, Step Functions, Transcribe và Bedrock đều có thể phát sinh phí.
- Dev mặc định PITR/deletion protection tắt; staging/prod phải review chi phí và vận hành trước khi bật.
- `DeletionPolicy: Retain` ngăn xóa dữ liệu do xóa stack nhầm, nhưng retained table vẫn phát sinh phí và phải quản lý thủ công.
- Sau mỗi phiên integration, kiểm tra CloudFormation stacks, tables, S3 objects, log groups, schedules và AI executions còn tồn tại.
