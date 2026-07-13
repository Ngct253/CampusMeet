# Hướng dẫn triển khai AWS CampusMeet theo giai đoạn

Tài liệu này là runbook AWS chung cho CampusMeet. Nhóm dùng stack integration nhỏ để xác minh từng nhóm dịch vụ trước khi triển khai `infra/template.yaml` đầy đủ. Việc một giai đoạn build được không có nghĩa là giai đoạn đó đã được deploy hoặc production-ready.

## 1. Trạng thái xác minh

| Giai đoạn                  | Trạng thái                                              | Bằng chứng hiện có                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication integration | **Đã thực hành và xác minh**                            | `sam validate --lint` và SAM build bằng esbuild đạt; change set đã được review; stack deploy thành công; `/health` không token trả `200`; `/me` không token trả `401`; đăng ký, xác nhận email và đăng nhập Cognito thành công; stack đã được xóa bằng `sam delete`; CloudFormation không còn stack hoạt động |
| Data layer                 | **Chưa triển khai thực tế — dự kiến cho giai đoạn sau** | Chưa có bằng chứng deploy DynamoDB, IAM data access hoặc API nghiệp vụ                                                                                                                                                                                                                                        |
| Notifications              | **Chưa triển khai thực tế — dự kiến cho giai đoạn sau** | Chưa deploy SES, EventBridge Scheduler hoặc Reminder Lambda                                                                                                                                                                                                                                                   |
| Frontend hosting           | **Chưa triển khai thực tế — dự kiến cho giai đoạn sau** | Chưa deploy S3 hoặc CloudFront                                                                                                                                                                                                                                                                                |
| Observability              | **Chưa triển khai thực tế — dự kiến cho giai đoạn sau** | Chưa xác minh metrics, alarms hoặc SNS của full stack                                                                                                                                                                                                                                                         |
| Full deployment            | **Chưa triển khai thực tế — dự kiến cho giai đoạn sau** | Chỉ thực hiện sau khi từng nhóm dịch vụ đã được kiểm thử riêng                                                                                                                                                                                                                                                |

Authentication integration là lần triển khai có thời hạn để kiểm thử, không phải môi trường AWS đang hoạt động. Không dùng kết quả đó để tuyên bố các phần còn lại đã deploy.

## 2. Nguyên tắc kiến trúc và chi phí

- `infra/template.yaml` là source of truth cho full stack; template integration chỉ phục vụ kiểm thử cô lập.
- Chỉ deploy tài nguyên tối thiểu cần cho test hiện tại. Không dùng EC2, RDS, NAT Gateway, Docker hoặc ECS trong kiến trúc thử nghiệm.
- Tạo change set và review tài nguyên, IAM, retention và chi phí trước khi execute.
- Test trong cùng phiên làm việc, lưu kết quả cần thiết, rồi chạy `sam delete` nếu chưa cần giữ môi trường demo.
- Xác nhận stack đã biến mất sau cleanup. Frontend local dừng hoặc xóa `.env.local` không xóa tài nguyên AWS.
- Log Group của authentication integration giữ log 7 ngày. Không tạo alarm, SNS, SES, DynamoDB hoặc frontend hosting khi test hiện tại chưa cần.
- Serverless tồn tại theo yêu cầu không giống máy chủ chạy 24/7, nhưng vẫn có thể phát sinh phí do request, lưu trữ, log, artifact hoặc cấu hình giữ lại. Không khẳng định chi phí tuyệt đối bằng `0`.
- Không dùng AWS root account; bật MFA và dùng profile/role có quyền tối thiểu.
- Không hard-code credential, token, account ID, ARN hoặc resource ID vào source và tài liệu.

## 3. Workflow chuẩn cho mọi giai đoạn

Mỗi giai đoạn phải đi qua đủ các bước sau; chỉ thay template, tài nguyên và test tương ứng.

1. **Purpose:** ghi rõ bài toán AWS cần giải quyết và điều kiện hoàn thành.
2. **Resources:** liệt kê đúng tài nguyên sẽ được tạo; loại bỏ tài nguyên ngoài phạm vi.
3. **Prerequisites:** xác nhận profile, Region, quyền, công cụ, budget và dữ liệu test.
4. **Local verification:** chạy typecheck, test và kiểm tra template/code liên quan.
5. **SAM validate:** lint template bằng SAM/CloudFormation rules.
6. **SAM build:** build artifact cục bộ, không sửa dependency source.
7. **Preview change set:** tạo change set nhưng chưa execute.
8. **Review resources and cost:** đọc change set, IAM, retention và tài nguyên có chi phí.
9. **Deploy:** chỉ execute sau khi review và có người chịu trách nhiệm cleanup.
10. **Read outputs:** lấy output từ CloudFormation, không chép identifier thật vào Git.
11. **Configure local environment:** đưa output cần thiết vào `.env.local` đã Git ignore.
12. **Smoke test:** kiểm tra endpoint hoặc resource boundary tối thiểu.
13. **End-to-end test:** kiểm tra luồng người dùng và trường hợp lỗi quan trọng.
14. **Logs and evidence:** kiểm tra log, lưu ảnh/kết quả workshop nhưng không lưu secret.
15. **Security review:** kiểm tra auth, IAM, CORS, dữ liệu nhạy cảm và public access.
16. **Cost review:** kiểm tra tài nguyên đang tồn tại, retention và chi phí dự kiến.
17. **Cleanup:** xóa stack integration khi không cần giữ demo.
18. **Verify deletion:** xác nhận CloudFormation không còn stack hoạt động và rà artifact/tài nguyên ngoài stack nếu có.

## 4. Các giai đoạn triển khai

### 4.1 Authentication

- **Purpose:** xác minh đăng ký, xác nhận email, đăng nhập, JWT authorizer, `/health`, `/me` và đăng xuất.
- **Resources:** Cognito User Pool, User Pool Client, HTTP API, JWT authorizer, một Lambda, IAM execution role và Log Group 7 ngày.
- **Prerequisites:** AWS CLI/SAM CLI, Node.js/npm, profile hợp lệ, Region và frontend origin local.
- **Local verification:** kiểm tra auth unit tests và entry point `services/api/src/auth-integration.ts` chỉ định tuyến `/health`, `/me`.
- **SAM validate:** lint `infra/auth-integration.yaml`.
- **SAM build:** chạy `npm run sam:build:auth`.
- **Preview change set:** dùng `--no-execute-changeset`, `--resolve-s3`, `AllowedOrigin` và `CAPABILITY_IAM`.
- **Review resources and cost:** xác nhận không có DynamoDB, SES, SNS, alarm, Scheduler, S3/CloudFront hoặc compute chạy thường trực.
- **Deploy:** execute change set đã review.
- **Read outputs:** đọc `UserPoolId`, `UserPoolClientId` và `ApiUrl`.
- **Configure local environment:** cập nhật ba biến Vite tương ứng trong `.env.local`.
- **Smoke test:** `/health` không token phải `200`; `/me` không token phải `401`.
- **End-to-end test:** đăng ký, nhận mã email, xác nhận, đăng nhập, gọi `/me` bằng access token và đăng xuất.
- **Logs and evidence:** lưu status code, kết quả luồng và log request cần thiết; không lưu password/token.
- **Security review:** client không có secret; `/me` chỉ tin claims từ API Gateway; CORS chỉ cho origin được truyền vào.
- **Cost review:** kiểm tra stack, Log Group, SAM artifact bucket và request phát sinh.
- **Cleanup:** chạy `sam delete` sau phiên test.
- **Verify deletion:** xác nhận không còn stack CloudFormation hoạt động. Phạm vi đã có bằng chứng thực hành được liệt kê chính xác tại bảng trạng thái; các tiêu chí còn lại phải được ghi nhận ở lần test tiếp theo trước khi đánh dấu đã xác minh.

### 4.2 Data layer

- **Purpose:** xác minh persistence và authorization cho group, meeting, task và notification.
- **Resources:** DynamoDB tables/indexes đã duyệt, quyền IAM tối thiểu và API Lambda nghiệp vụ.
- **Prerequisites:** access patterns, keys/indexes, conditional writes, idempotency và retention/PITR đã chốt.
- **Local verification:** unit/integration tests dùng adapter local, không gọi AWS thật.
- **SAM validate:** lint template integration data hoặc phần tương ứng của full template.
- **SAM build:** build đúng Lambda nghiệp vụ và kiểm tra artifact.
- **Preview change set:** tạo change set chưa execute.
- **Review resources and cost:** kiểm tra table, billing mode, indexes, PITR và IAM resource scope.
- **Deploy:** chỉ deploy stack data integration tối thiểu.
- **Read outputs:** lấy tên table/API output vào cấu hình local.
- **Configure local environment:** dùng `.env.local`, không commit table name hoặc API URL thật.
- **Smoke test:** health và một thao tác ghi/đọc có kiểm soát.
- **End-to-end test:** xác minh ownership/membership và từ chối truy cập chéo nhóm.
- **Logs and evidence:** lưu request ID và kết quả access pattern, không lưu dữ liệu nhạy cảm.
- **Security review:** không tin `userId` từ frontend; IAM chỉ cho đúng table/action.
- **Cost review:** rà on-demand/provisioned mode, indexes, PITR và dữ liệu test.
- **Cleanup:** xóa stack integration và dữ liệu test theo chính sách đã duyệt.
- **Verify deletion:** xác nhận table/backups ngoài ý muốn không còn. Giai đoạn này **chưa triển khai thực tế**.

### 4.3 Notifications

- **Purpose:** xác minh reminder đúng thời điểm và email là kênh bổ sung cho in-app notification.
- **Resources:** SES, EventBridge Scheduler, Reminder Lambda, execution role và log cần thiết.
- **Prerequisites:** meeting lifecycle, schedule naming, retry/idempotency và SES sandbox identities đã chốt.
- **Local verification:** test meeting hủy/cập nhật, retry và trường hợp SES lỗi.
- **SAM validate:** lint template notifications integration.
- **SAM build:** build riêng Reminder Lambda.
- **Preview change set:** tạo change set chưa execute.
- **Review resources and cost:** kiểm tra schedules, role, SES resources và log retention.
- **Deploy:** deploy integration stack trong thời gian giới hạn.
- **Read outputs:** lấy function/schedule outputs cần cho test.
- **Configure local environment:** chỉ lưu reference, không lưu secret hoặc email thật trong Git.
- **Smoke test:** invoke có kiểm soát và kiểm tra notification record/log.
- **End-to-end test:** schedule một lần, meeting hủy và email thất bại không làm mất notification.
- **Logs and evidence:** lưu thời điểm schedule, request ID và trạng thái, che địa chỉ người nhận.
- **Security review:** least privilege cho Scheduler và SES; không log nội dung nhạy cảm.
- **Cost review:** kiểm tra schedule còn hoạt động, Lambda invocation và log.
- **Cleanup:** xóa schedules rồi stack nếu CloudFormation không tự xử lý đủ.
- **Verify deletion:** xác nhận không còn schedule, function hoặc SES resource ngoài ý muốn. Giai đoạn này **chưa triển khai thực tế**.

### 4.4 Frontend hosting

- **Purpose:** phân phối React static build qua S3 private và CloudFront.
- **Resources:** S3 bucket, CloudFront distribution, Origin Access Control và policy liên quan.
- **Prerequisites:** production build, SPA fallback, domain/origin và cleanup owner đã chốt.
- **Local verification:** `npm run build` và kiểm tra `apps/web/dist`.
- **SAM validate:** lint template hosting.
- **SAM build:** xác nhận artifact/template; không upload thủ công trước change-set review.
- **Preview change set:** tạo change set chưa execute.
- **Review resources and cost:** kiểm tra public access block, OAC, cache behavior, logs và distribution.
- **Deploy:** deploy hosting integration khi cần demo.
- **Read outputs:** lấy bucket/distribution URL và ID qua CloudFormation outputs.
- **Configure local environment:** cập nhật frontend/API origin đúng môi trường.
- **Smoke test:** tải trang và static assets qua CloudFront; S3 vẫn private.
- **End-to-end test:** refresh trực tiếp SPA route và kiểm tra auth redirect.
- **Logs and evidence:** lưu URL đã che identifier khi đưa vào tài liệu public.
- **Security review:** không public bucket; review headers, TLS và CORS.
- **Cost review:** kiểm tra storage, transfer, invalidation và distribution còn bật.
- **Cleanup:** empty bucket theo runbook rồi xóa stack nếu cần.
- **Verify deletion:** xác nhận distribution, OAC và bucket đã biến mất. Giai đoạn này **chưa triển khai thực tế**.

### 4.5 Observability

- **Purpose:** cung cấp logs, metrics và cảnh báo đủ để vận hành/demo.
- **Resources:** CloudWatch Log Groups, metrics/alarms và SNS khi thật sự cần người nhận cảnh báo.
- **Prerequisites:** metric, threshold, recipient, retention và test-failure plan đã duyệt.
- **Local verification:** kiểm tra structured log và không log token/password/secret.
- **SAM validate:** lint observability resources.
- **SAM build:** build Lambda phát metric/log nếu có.
- **Preview change set:** tạo change set chưa execute.
- **Review resources and cost:** kiểm tra custom metrics, retention, alarm actions và SNS subscriptions.
- **Deploy:** chỉ deploy sau khi workload cần quan sát đã tồn tại.
- **Read outputs:** lấy log group/alarm/topic reference cần cho vận hành.
- **Configure local environment:** không đưa ARN hoặc subscription endpoint thật vào Git.
- **Smoke test:** tìm log theo request ID và kiểm tra metric có dữ liệu.
- **End-to-end test:** tạo lỗi có kiểm soát, xác minh alarm rồi đưa metric về bình thường.
- **Logs and evidence:** lưu ảnh log/alarm đã che dữ liệu nhạy cảm.
- **Security review:** quyền đọc log và publish SNS tối thiểu; recipient phải xác nhận.
- **Cost review:** rà ingestion, retention, custom metrics và alarm count.
- **Cleanup:** xóa stack integration hoặc tài nguyên test không còn dùng.
- **Verify deletion:** xác nhận alarm/topic/log ngoài chính sách không còn. Giai đoạn này **chưa triển khai thực tế**.

### 4.6 Full deployment

- **Purpose:** triển khai kiến trúc CampusMeet hoàn chỉnh sau khi từng nhóm dịch vụ đã được xác minh riêng.
- **Resources:** Cognito, API Gateway/Lambda, DynamoDB, Scheduler/Reminder, SES, S3/CloudFront và observability đã duyệt.
- **Prerequisites:** tất cả integration checklist liên quan đạt; rollback, cleanup owner và budget được chốt.
- **Local verification:** chạy toàn bộ lint, typecheck, test và application build.
- **SAM validate:** lint `infra/template.yaml`.
- **SAM build:** build full template và rà artifact của từng Lambda.
- **Preview change set:** luôn tạo change set chưa execute.
- **Review resources and cost:** đối chiếu resource inventory với kiến trúc; dừng nếu có tài nguyên ngoài dự kiến.
- **Deploy:** execute theo cửa sổ triển khai đã thống nhất.
- **Read outputs:** lưu cấu hình môi trường ở nơi phù hợp, không commit identifier thật.
- **Configure local environment:** cập nhật frontend/backend config theo outputs.
- **Smoke test:** health, auth, API, data, notifications và frontend hosting.
- **End-to-end test:** chạy luồng CampusMeet đã chốt cùng failure cases.
- **Logs and evidence:** thu thập bằng chứng workshop và request IDs.
- **Security review:** auth, IAM, public access, CORS, secret handling và cross-group access.
- **Cost review:** kiểm tra Billing/Cost Explorer, retention và tài nguyên tồn tại.
- **Cleanup:** giữ môi trường chỉ khi có owner/deadline rõ ràng; nếu không, xóa stack theo thứ tự phụ thuộc.
- **Verify deletion:** rà mọi Region và artifact managed ngoài stack. Giai đoạn này **chưa triển khai thực tế**.

## 5. Các lệnh PowerShell đã xác minh

Chỉ thay placeholder tại máy local; không đưa giá trị thật vào source hoặc tài liệu public.

### Đăng nhập và xác nhận danh tính

```powershell
aws login `
  --profile <aws-profile> `
  --region <aws-region>

aws sts get-caller-identity `
  --profile <aws-profile>
```

### Validate

```powershell
sam validate `
  --template-file <template-path> `
  --lint `
  --profile <aws-profile> `
  --region <aws-region>
```

### Build authentication integration

```powershell
npm ci
npm exec -- esbuild --version
npm run sam:build:auth
```

`esbuild@0.25.12` nằm trong root `devDependencies` của monorepo. Auth integration dùng `CodeUri: ../services/api/src`, nên SAM bundle trực tiếp TypeScript mà không chạy npm update trong workspace API. Không dùng `--build-in-source`: cách đó từng làm SAM chạy `NodejsNpmEsbuildBuilder:NpmUpdate` trong source và xóa executable được hoist như `node_modules/.bin/esbuild.cmd`.

### Preview change set

```powershell
sam deploy `
  --template-file infra/auth-integration.yaml `
  --stack-name <stack-name> `
  --resolve-s3 `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides AllowedOrigin=<frontend-origin> `
  --no-execute-changeset `
  --profile <aws-profile> `
  --region <aws-region>
```

Lần đầu, `--resolve-s3` có thể tạo hoặc dùng SAM managed S3 bucket và upload artifact. `--no-execute-changeset` chưa tạo tài nguyên ứng dụng trong change set, nhưng artifact/bucket managed có thể đã tồn tại và cần được tính vào cost/cleanup review.

Review change set bằng Console hoặc CLI, xác nhận resource inventory và IAM trước khi execute:

```powershell
aws cloudformation describe-change-set `
  --change-set-name <change-set-name> `
  --stack-name <stack-name> `
  --profile <aws-profile> `
  --region <aws-region>

aws cloudformation execute-change-set `
  --change-set-name <change-set-name> `
  --stack-name <stack-name> `
  --profile <aws-profile> `
  --region <aws-region>
```

Chờ trạng thái phù hợp với thao tác (`stack-create-complete` cho lần tạo đầu hoặc `stack-update-complete` cho cập nhật), rồi đọc outputs:

```powershell
aws cloudformation wait stack-create-complete `
  --stack-name <stack-name> `
  --profile <aws-profile> `
  --region <aws-region>

aws cloudformation describe-stacks `
  --stack-name <stack-name> `
  --query "Stacks[0].Outputs" `
  --profile <aws-profile> `
  --region <aws-region>
```

### Smoke test

```powershell
curl.exe --ssl-no-revoke -i "<api-url>/health"
curl.exe --ssl-no-revoke -i "<api-url>/me"
```

Kỳ vọng `/health` trả `200`; `/me` không có Bearer token trả `401`. `--ssl-no-revoke` chỉ là workaround cho lỗi Schannel trên một số máy Windows, không phải cấu hình production mặc định.

### Cleanup và xác nhận xóa

```powershell
sam delete `
  --stack-name <stack-name> `
  --profile <aws-profile> `
  --region <aws-region>

aws cloudformation list-stacks `
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE `
  --query "StackSummaries[?StackName=='<stack-name>'].StackStatus" `
  --profile <aws-profile> `
  --region <aws-region>
```

Kết quả truy vấn cuối phải rỗng. Nếu stack lỗi xóa, đọc stack events và xử lý resource giữ lại có chủ đích; không xóa thủ công khi chưa xác định ownership.

## 6. Quản lý cấu hình môi trường

- Dùng `apps/web/.env.local` cho outputs của môi trường local; file này phải được Git ignore.
- Không commit User Pool ID, Client ID, API URL, token hoặc credential thật.
- `apps/web/.env.example` chỉ chứa tên biến, chú thích và placeholder.
- Sau khi stack bị xóa, outputs cũ không còn sử dụng được; cập nhật hoặc xóa `.env.local`.
- Vite chỉ đọc lại env khi khởi động; phải restart dev server sau khi sửa `.env.local`.
- Dừng frontend hoặc xóa `.env.local` không dừng API/Cognito và không cleanup AWS stack.

## 7. Troubleshooting đã gặp thực tế

| Hiện tượng                                     | Cách xử lý                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS CLI session hết hạn                        | Chạy lại `aws login`, rồi kiểm tra `aws sts get-caller-identity` đúng profile/Region                                                            |
| Cognito trả `InvalidPasswordException`         | Hiển thị yêu cầu mật khẩu có thể hành động, không log password; kiểm tra password policy của User Pool                                          |
| Frontend chỉ hiện lỗi chung                    | Giữ thông báo an toàn cho production nhưng ánh xạ lỗi Cognito phổ biến sang hướng dẫn tiếng Việt có thể hành động                               |
| `--build-in-source` thay đổi dependency source | Bỏ flag; thu hẹp `CodeUri` đến thư mục source không có workspace `package.json`                                                                 |
| SAM không tìm thấy esbuild                     | Đặt đúng `esbuild@0.25.12` ở root `devDependencies`, chạy `npm ci`, kiểm tra `npm exec -- esbuild --version` và `node_modules/.bin/esbuild.cmd` |
| Có npm 404 cho `@campusmeet/shared`            | Không để SAM chạy npm install trong `services/api`; auth bundle không có runtime import package này                                             |
| Managed S3 bucket xuất hiện lần đầu            | Đây có thể là artifact bucket do `--resolve-s3`; ghi nhận trong cost/cleanup review                                                             |
| `curl.exe` báo `CRYPT_E_NO_REVOCATION_CHECK`   | Có thể dùng `--ssl-no-revoke` cho smoke test local trên máy bị lỗi; không coi đây là production setting                                         |
| `/me` trả `401` không token                    | Đây là hành vi đúng của JWT authorizer; gửi access token bằng `Authorization: Bearer <access-token>` khi test authenticated                     |
| `.env.local` chưa được nạp                     | Restart Vite sau khi sửa file; xác nhận đúng đường dẫn `apps/web/.env.local`                                                                    |

Không đưa password, token, email thật hoặc AWS identifier thật vào issue, screenshot public hay log troubleshooting.

## 8. Checklist dùng lại cho phần AWS tiếp theo

- [ ] Xác định bài toán cần AWS giải quyết và tiêu chí hoàn thành.
- [ ] Chỉ chọn tài nguyên tối thiểu.
- [ ] Tạo template integration riêng nếu full stack quá lớn để review an toàn.
- [ ] Validate và build local.
- [ ] Tạo, đọc và lưu bằng chứng review change set.
- [ ] Dừng nếu thấy tài nguyên ngoài dự kiến.
- [ ] Review IAM, security, retention và chi phí.
- [ ] Deploy trong thời gian giới hạn với owner cleanup rõ ràng.
- [ ] Chạy smoke test và end-to-end test.
- [ ] Kiểm tra CloudWatch logs theo request ID.
- [ ] Lưu bằng chứng phục vụ workshop, không lưu dữ liệu nhạy cảm.
- [ ] Cleanup trong cùng ngày nếu không cần giữ demo.
- [ ] Xác nhận stack đã biến mất và rà tài nguyên ngoài stack.
- [ ] Cập nhật trạng thái “đã xác minh” trong tài liệu, không suy diễn từ build thành deploy.
