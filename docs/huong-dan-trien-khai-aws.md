# Hướng dẫn triển khai AWS CampusMeet theo giai đoạn

> Hiện repository chỉ có AWS SAM skeleton. Chưa có AWS resource nào được tạo bởi project. Không chạy deploy cho đến khi các điều kiện của từng giai đoạn được đáp ứng.

Tài liệu này là runbook tương lai cho M5 và reviewer. Nó không cấp quyền tự deploy và không khẳng định template đã production-ready.

## 1. Nguyên tắc triển khai

- `infra/template.yaml` là source of truth.
- Chỉ deploy môi trường `dev` trước; không dùng AWS root account và phải bật MFA.
- Thiết lập Budget Alert trước khi deploy.
- Không dùng VPC, NAT Gateway, EC2, RDS hoặc ALB trong MVP.
- Không hard-code secret, account ID hoặc credential.
- Không tạo thủ công resource trùng với IaC.
- Google OAuth nằm ở Google Cloud, không phải AWS.
- SES email là kênh bổ sung; in-app notification là bắt buộc.
- Mọi thay đổi IAM, deletion policy, log retention và CORS phải được review.

## 2. AWS service trong CampusMeet

| Service                              | Dùng để làm gì trong CampusMeet                 | Owner chính       | Giai đoạn triển khai | Cách kiểm tra                                       | Lưu ý chi phí/bảo mật                                         |
| ------------------------------------ | ----------------------------------------------- | ----------------- | -------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| S3                                   | Lưu frontend static assets trong private bucket | M5                | 2–3                  | Bucket không public; object tải qua CloudFront      | Block Public Access; dọn object trước khi xóa                 |
| CloudFront                           | Phân phối frontend ở edge/global qua OAC        | M5                | 2–3                  | Mở distribution URL, SPA routes hoạt động           | OAC chỉ đọc bucket; invalidation có quota/cost                |
| Cognito                              | User Pool và web client cho xác thực            | M5 phối hợp M1/M3 | 2–4                  | Sign-up/sign-in/callback sau khi auth thật có       | Callback URL chính xác; không tạo client secret cho SPA       |
| API Gateway HTTP API                 | HTTP boundary tới Lambda                        | M5 phối hợp M3    | 2–4                  | Gọi `/health`; sau đó protected route               | Thay CORS wildcard bằng frontend origin thật                  |
| Lambda API                           | Route dispatch và application use cases         | M3/M5             | 2–4                  | `/health`, logs và request ID                       | Least privilege, không log token/secret                       |
| Lambda Reminder                      | Xử lý one-time reminder                         | M5 phối hợp M3    | 2, 7                 | Invoke test có kiểm soát, notification record/log   | Phải kiểm tra meeting chưa bị hủy                             |
| DynamoDB                             | Group, meeting, task, notification data         | M3 phối hợp M5    | 2, 5                 | Record demo và access pattern test                  | Tables hiện là placeholder; chốt index/PITR trước production  |
| EventBridge Scheduler                | Tạo one-time reminder schedule                  | M5                | 7                    | Schedule target/role/time và execution log          | Hủy/cập nhật meeting phải cập nhật schedule                   |
| SES                                  | Gửi email reminder bổ sung                      | M5                | 8                    | Verified demo recipient nhận email                  | Sandbox/identity limits; lỗi email không làm mất notification |
| CloudWatch                           | Logs, metrics và alarm cho API/Reminder         | M5                | 2, 8                 | Log có requestId; alarm đổi trạng thái khi demo lỗi | Retention 14 ngày hiện là scaffold; tránh log nhạy cảm        |
| SNS                                  | Nhận action từ CloudWatch Alarm                 | M5                | 8                    | Subscription đã confirm, nhận cảnh báo thử          | Xác nhận email subscription; tránh spam                       |
| Secrets Manager hoặc Parameter Store | Lưu Google OAuth secret/server config           | M4/M5             | 6                    | Lambda đọc được reference sau khi IAM được chốt     | Không truyền secret value vào template/source/log             |

## 3. Các giai đoạn triển khai

### Giai đoạn 0 — Chuẩn bị AWS account

Điều kiện:

- Chốt AWS Region dev.
- Bật MFA, dùng IAM user/role hoặc SSO; không dùng root.
- Tạo Budget Alert và người nhận cảnh báo.
- Cài AWS CLI và SAM CLI trên máy M5.
- Không đưa credential vào Git hoặc `.env` được commit.

Nếu AWS CLI đã được cấu hình đúng, M5 có thể tự kiểm tra danh tính bằng `aws sts get-caller-identity`. Không chạy lệnh đó như một phần tự động của repository này.

### Giai đoạn 1 — Kiểm tra IaC trước deploy

1. Đọc toàn bộ `infra/template.yaml` và diff của PR.
2. Kiểm tra `DomainName`, Cognito callback URLs và Google secret reference.
3. Thay CORS wildcard bằng CloudFront/custom domain thật trước khi dùng môi trường chia sẻ.
4. Review IAM actions/resources, đặc biệt SES wildcard, `iam:PassRole` và deployment role placeholder.
5. Review deletion/retention, DynamoDB PITR, log retention và tags.
6. Nếu SAM CLI đã có, chạy:

```bash
sam validate --lint -t infra/template.yaml
```

Chỉ validation, không deploy. `DeploymentRole` hiện chỉ có quyền đọc stack và chưa phải CI deployment role hoàn chỉnh.

### Giai đoạn 2 — Deploy hạ tầng dev trong tương lai

Sau khi Giai đoạn 0–1 được duyệt, M5 mới lập PR/runbook deploy cụ thể. SAM stack dự kiến tạo DynamoDB, Cognito, API Gateway, API/Reminder Lambda, S3, CloudFront, logs, SNS và alarm theo dependency CloudFormation.

Sau deploy:

1. Lấy stack outputs và lưu trong cấu hình môi trường an toàn.
2. Không commit secret hoặc account-specific credential.
3. Cập nhật callback URL Cognito bằng CloudFront/custom domain thật nếu cần.
4. Cấu hình frontend gọi API URL dev.
5. Ghi lại stack name, Region, owner, ngày tạo và cleanup deadline.

Đây là giai đoạn tương lai; repository hiện không chạy deploy.

### Giai đoạn 3 — Deploy frontend

1. Chạy `npm run build` để tạo `apps/web/dist`.
2. Upload static assets vào bucket lấy từ `FrontendBucketName` output.
3. Invalidate CloudFront cache bằng distribution ID thật.
4. Mở CloudFront URL và kiểm tra trang chủ, asset, refresh SPA route.

Không public S3 bucket; OAC phải là đường đọc duy nhất. Template hiện chưa output CloudFront distribution ID, nên command sync/invalidation cụ thể phải được M5 xác nhận hoặc bổ sung output qua PR trước khi chạy, không đoán ID.

### Giai đoạn 4 — Cognito và API

- User Pool/client được tạo bằng IaC.
- M1/M5 cấu hình callback URL và frontend auth flow.
- Frontend gửi Cognito token; API Gateway/Lambda phải xác minh JWT/claims theo design đã chốt.
- Kiểm tra `/health` trước vì endpoint này không chứa nghiệp vụ.
- Chỉ test protected API sau khi authentication và backend use case thật hoàn thiện.

Template hiện chưa có API authorizer; không mô tả Cognito bảo vệ API như đã hoạt động.

### Giai đoạn 5 — DynamoDB

Template hiện có bốn placeholder table:

| Table                | Dữ liệu dự kiến                                                 |
| -------------------- | --------------------------------------------------------------- |
| `GroupsTable`        | Group và thiết kế membership/invitation sau khi chốt            |
| `MeetingsTable`      | Meeting, attendee/reminder linkage theo access pattern đã duyệt |
| `TasksTable`         | Task/action item linkage                                        |
| `NotificationsTable` | In-app notification                                             |

M3 phải chốt access patterns, keys/indexes, conditional writes và idempotency trước production. Các table chỉ có khóa `id` hiện tại không phải database design hoàn chỉnh. Kiểm tra record demo bằng read-only console/CLI sau khi use case thật ghi dữ liệu. Chỉ bật PITR khi nhóm chốt nhu cầu và cost.

### Giai đoạn 6 — Google OAuth và Google Calendar

- M4 tạo Google Cloud project, OAuth consent screen và redirect URIs ngoài AWS.
- OAuth secret/token chỉ lưu server-side trong Secrets Manager hoặc Parameter Store bằng reference.
- Lambda chỉ được cấp quyền đọc đúng secret sau khi adapter thật tồn tại và IAM đã review.
- Adapter tạo Calendar Event với conference data, theo dõi `PENDING`, `READY`, `FAILED`.
- Retry phải idempotent, không tạo event trùng; không fake Meet link.

Google configuration không được tạo hay giả lập bởi SAM template.

### Giai đoạn 7 — Reminder

Luồng mục tiêu: meeting tạo/cập nhật → EventBridge Scheduler tạo one-time schedule → đến giờ gọi Reminder Lambda → Lambda kiểm tra meeting → tạo in-app notification → thử gửi SES email.

- Hủy meeting phải xóa/hủy schedule.
- Cập nhật thời gian meeting phải cập nhật schedule idempotently.
- Kiểm tra schedule target/role, CloudWatch log, notification record và trường hợp meeting đã hủy.

Adapter và Lambda hiện vẫn là placeholder.

### Giai đoạn 8 — SES, CloudWatch và SNS

- SES sandbox có thể yêu cầu verify cả sender và recipient demo.
- Email lỗi không làm mất in-app notification.
- Log API/Reminder có `requestId` nhưng không có token, secret, OAuth code hoặc password.
- CloudWatch Alarm theo dõi lỗi Lambda/API và gửi SNS.
- SNS email subscription chỉ hoạt động sau khi người nhận confirm.
- Alarm demo phải dùng lỗi có chủ đích trong môi trường dev và có kế hoạch đưa metric về bình thường.

## 4. Trạng thái và điều kiện chuyển giai đoạn

| Thành phần       | Hiện tại                                       | Điều kiện để bắt đầu triển khai thật                                 |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Frontend         | Scaffold + mock, build được                    | API/auth contract và dev config được chốt                            |
| API              | Health implemented locally; nghiệp vụ skeleton | Validation/auth/application design và tests được chốt                |
| DynamoDB         | SAM placeholder                                | Access patterns, keys/indexes, retention/PITR review                 |
| Cognito          | SAM skeleton                                   | Callback URLs, UX và authorizer design review                        |
| Google           | Gateway/UI notes placeholder                   | Consent screen, redirect URI, secret store, idempotency design       |
| Reminder/SES     | Handler/adapter skeleton                       | Meeting lifecycle, schedule naming, SES identities và failure policy |
| Monitoring       | Log groups/alarm/SNS skeleton                  | Metrics, recipients, thresholds và demo plan                         |
| Deploy dev       | Chưa thực hiện                                 | Giai đoạn 0–1 hoàn tất, M5 và cả nhóm approve                        |
| Verified         | Chưa có                                        | Checklist sau deploy có evidence                                     |
| Production-ready | Chưa có                                        | Security/cost/load/backup/rollback review riêng                      |

`scaffold`, `implemented locally`, `deployed to dev`, `verified` và `production-ready` là năm trạng thái khác nhau; không dùng thay thế cho nhau.

## 5. Checklist sau deploy

- [ ] CloudFront tải frontend, S3 vẫn private và refresh SPA route hoạt động.
- [ ] `GET /health` trả `200`, không lộ secret.
- [ ] Cognito sign-up/sign-in/callback hoạt động với URL đúng.
- [ ] Protected API từ chối token thiếu/sai và cross-group access.
- [ ] DynamoDB có record demo đúng access pattern, không có token/secret.
- [ ] Google event có trạng thái đúng; Meet link chỉ hiện khi `READY`.
- [ ] EventBridge schedule đúng target, role và thời gian.
- [ ] In-app notification được tạo kể cả khi SES lỗi.
- [ ] SES email demo hoạt động khi identity/sandbox cho phép.
- [ ] CloudWatch logs có requestId và không chứa dữ liệu nhạy cảm.
- [ ] Alarm/SNS gửi được cảnh báo thử có kiểm soát.

## 6. Chi phí và cleanup

Chỉ cleanup sau khi backup evidence workshop. Ưu tiên xóa CloudFormation/SAM stack theo runbook đã review, rồi kiểm tra resource còn sót:

- CloudFormation stack và nested artifacts nếu có.
- S3 objects/bucket; kiểm tra versioned objects trước khi xóa.
- CloudFront distribution và OAC.
- Lambda functions, versions/aliases và permissions.
- API Gateway routes/stages/domain mappings.
- DynamoDB tables/backups/PITR.
- Cognito app client/domain/User Pool.
- EventBridge schedules và schedule groups.
- CloudWatch alarms, custom metrics và log retention.
- SNS topic/subscription.
- SES identities/configuration set.
- Secrets Manager/Parameter Store secret và recovery window/cost.
- Budget alert nếu nhóm không còn dùng account/project.

Kiểm tra mọi Region và Billing/Cost Explorer sau cleanup. Không để S3 bucket, CloudFront distribution, schedule hoặc secret tồn tại ngoài ý muốn; không chạy lệnh xóa khi chưa xác nhận stack/Region/resource owner.
