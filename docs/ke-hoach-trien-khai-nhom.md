# Kế hoạch triển khai CampusMeet cho nhóm 5 người

Kế hoạch này chuyển scaffold thành các vertical slice có thể demo trong 8 tuần. Phạm vi nghiệp vụ vẫn do [SRS](CampusMeet-SRS.md) quyết định.

## 1. Sau scaffold, cả nhóm cần làm gì?

- [ ] Mỗi người clone repository và cài đúng Node/npm.
- [ ] Chạy `npm install`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- [ ] Đọc README, SRS, architecture, API contract và hướng dẫn cấu trúc repository.
- [ ] Mở UI và xác nhận banner **Chế độ dữ liệu mô phỏng**.
- [ ] Chốt M1–M5 thành tên người thật trong buổi họp nhóm.
- [ ] Chọn GitHub Issues hoặc GitHub Project làm nguồn theo dõi duy nhất.
- [ ] Tạo issue trước khi bắt đầu feature.
- [ ] Commit baseline scaffold trước khi code nghiệp vụ thật.
- [ ] Không làm feature ngoài scope SRS.

## 2. Phân công ownership

| Thành viên | Ownership chính                   | Đầu ra bàn giao                                                                                            | Không phải ownership chính                | Phối hợp chính                                       |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| M1           | Frontend foundation và dashboard  | AppShell, route guard, dashboard, AI job/citation state, panel và Document PiP fallback                         | Group workflow, Google OAuth, AWS deployment | M2/M3 về contract; M5 về Cognito/config               |
| M2           | Group, membership, invitation và transcript UX | Vertical slice nhóm/thành viên; transcript editor, timestamp playback, confidence và speaker mapping   | Google/AWS provider integration              | M1 về UI; M3 về authorization/repository              |
| M3           | Meeting, minutes, task, domain/API | Meeting/minutes/task, authorization theo `groupId`; attachment/AIJob/tool proposal application service         | Google token, SAM deployment                 | M2 về membership/UX; M4 về grounding; M5 về runtime  |
| M4           | Google và AI grounding            | OAuth, Calendar/Meet artifact adapter, conference states; Bedrock prompt/citation/evaluation dataset             | Dashboard, reminder infrastructure           | M3 về lifecycle/tool policy; M5 về secret/provider    |
| M5           | AWS, AI pipeline và vận hành      | SAM/IaC, S3 upload, Step Functions, Transcribe, Bedrock/Knowledge Base/S3 Vectors, monitoring, cost và cleanup   | Feature UI và domain workflow                | Tất cả owner về env, metrics và deployment            |

Ownership là người chịu trách nhiệm chính về outcome, không có nghĩa một người phải tự làm toàn bộ code. Mọi integration phải qua API contract và Pull Request.

## 3. Kế hoạch 8 tuần

| Tuần | Mục tiêu                      | Công việc chính                                                                                       | Mốc kiểm tra                                                           |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | Khóa baseline                  | Commit scaffold, chốt API/data model/Git workflow, test Google OAuth feasibility sớm, rà SAM skeleton | 5 máy đều install và quality gates pass; owner đã gán             |
| 2     | Group foundation                | Group CRUD nội bộ, membership model, authorization boundary cơ bản                                   | Tạo/xem group bằng UI → API dev/local                                 |
| 3     | Invitation và meeting nội bộ | Invitation accept/reject/expiry, meeting CRUD chưa Google                                               | Mốc MVP 1 chạy đầu-cuối và có test quyền âm                     |
| 4     | Luồng sau họp                 | Minutes, decisions, action items, tasks, dashboard                                                       | Mốc MVP 2 chạy đầu-cuối                                             |
| 5     | Google integration              | OAuth, Calendar Event, `googleSyncStatus`, retry/idempotency và prototype Meet artifact sync               | Demo pending/ready/retry/action-required; artifact fallback; không có Meet link giả |
| 6     | Reminder, notification và AI data | EventBridge reminder; S3 presigned upload; Attachment/Recording/AIJob; consent và retention        | Hủy meeting không gửi reminder; binary không qua API; upload policy test |
| 7     | AI vertical slice và vận hành | Batch STT tiếng Việt, transcript editor, Bedrock Q&A/citation, minutes/action-item draft; alarm/cost | Demo audio/tài liệu → transcript → draft → hỏi đáp; fallback thủ công |
| 8     | Đóng băng                    | Test chéo nhóm, prompt injection, tool confirmation; fix, demo, cleanup rehearsal                      | Core MVP + AI MVP pass; evidence/cost/cleanup xác nhận                |

Hai mốc MVP bắt buộc:

1. Tạo nhóm → mời thành viên → tham gia nhóm → tạo cuộc họp nội bộ.
2. Tạo cuộc họp → biên bản → task → cập nhật `DONE` → dashboard thay đổi.
3. Upload tài liệu/audio → AIJob → transcript có timestamp/confidence → người dùng sửa/ánh xạ speaker → draft biên bản/action item → hỏi đáp có citation.

Pha mở rộng sau baseline: RAG nhiều cuộc họp, agenda/form prefill, tool proposal nhiều miền, Document PiP và live transcription. Không đưa các mục này vào tuần 7-8 nếu ba mốc bắt buộc chưa ổn định.

## 4. Phụ thuộc giữa các luồng

| Luồng                | Phụ thuộc                                             | Owner chính | Owner phối hợp                      |
| --------------------- | ------------------------------------------------------- | ------------ | ------------------------------------- |
| Group                 | Cognito identity, shared DTO                            | M2           | M1, M3, M5                            |
| Membership/invitation | Group, authorization, email/link policy                 | M2           | M3, M5                                |
| Meeting               | Group membership, organizer rule                        | M3           | M1, M4                                |
| Google integration    | Meeting lifecycle, OAuth config, secret storage         | M4           | M3, M5                                |
| Reminder              | Meeting status, scheduler role, notification repository | M5           | M3, M4                                |
| Minutes/task          | Completed meeting, active member rule                   | M3           | M1, M2                                |
| Dashboard             | Meeting/task APIs và permission                        | M1           | M2, M3                                |
| Monitoring            | API/Reminder signals, SNS subscription                  | M5           | M2–M4 định nghĩa metric hữu ích |
| Attachment/recording  | Membership, S3 policy, consent/retention, checksum/scan | M5           | M2 về UX; M3 về contract/authorization |
| STT/transcript        | Recording hợp lệ, AIJob, provider benchmark             | M5           | M2 transcript UX; M3 data model; M4 evaluation |
| Bedrock grounding     | Nguồn đã duyệt, citation schema, ACL filter             | M4           | M3 application/API; M5 runtime/Knowledge Base |
| Tool proposal         | API nghiệp vụ và authorization hoàn chỉnh               | M3           | M1 preview UX; M4 prompt/evaluation; M5 audit/metric |

## 5. Git và Pull Request

Không code trực tiếp hoặc force push vào `main`. Một branch xử lý một issue/việc nhỏ; PR bắt buộc có review và không merge khi lint/typecheck/test/build lỗi. Không commit secret.

```bash
git checkout main
git pull origin main
git checkout -b feat/group-membership
```

Quy ước branch:

```text
feat/...
fix/...
docs/...
test/...
chore/...
refactor/...
```

Commit mẫu:

```text
feat: add group creation flow
fix: prevent reminder after meeting cancellation
docs: update AWS deployment guide
test: add authorization tests
```

PR template ngắn:

```markdown
## Mục tiêu

## Thay đổi chính

## Cách kiểm thử

## Ảnh/video minh chứng

## Issue liên quan

## Phần chưa hoàn thành hoặc rủi ro
```

## 6. Khi nào một luồng MVP được xem là hoàn thành?

Một luồng chỉ hoàn thành khi có:

- UI sử dụng được và gọi được API/xử lý server tương ứng.
- Validation cơ bản và kiểm tra quyền.
- Dữ liệu thật hoặc adapter thật khi module đã vào sprint; mock được ghi rõ khi chưa vào sprint.
- Lỗi dễ hiểu, happy-path test và ít nhất một lỗi quan trọng được test.
- PR đã review; tài liệu/ảnh minh chứng cập nhật khi cần.

UI không lưu dữ liệu hoặc API không thể dùng từ UI thì chưa hoàn thành luồng.

## 7. Bằng chứng đóng góp cá nhân

Mỗi thành viên lưu bằng chứng cho phần mình phụ trách:

- Issue/task, branch, PR và commit rõ nghĩa.
- Test và kết quả quality gates.
- Ảnh/video demo.
- Screenshot AWS/CloudWatch nếu có.
- Worklog tuần và phần workshop/tài liệu đã viết.

Không đưa token, credential, user data hoặc log nhạy cảm vào evidence.

## 8. Điểm cần nhóm chốt

| Nội dung                        | Lựa chọn/Ghi chú                                           | Người chốt  | Hạn chốt         |
| -------------------------------- | ------------------------------------------------------------- | -------------- | ------------------ |
| Tên thật tương ứng M1–M5   | Điền sau buổi phân công                                  | Cả nhóm      | Tuần 1            |
| GitHub Issues hay GitHub Project | Chọn một nguồn theo dõi duy nhất                         | Cả nhóm      | Tuần 1            |
| AWS Region dev                   | Chưa chốt; kiểm tra availability/chi phí                  | M5 + cả nhóm | Trước deploy dev |
| Email demo SES                   | Chưa chốt sender/recipient và consent                      | M5             | Trước tuần 6    |
| Redirect URI local               | Dự kiến`http://localhost:5173/...`; M4/M5 xác nhận flow | M4 + M5        | Tuần 1            |
| Redirect URI deployed            | Phụ thuộc CloudFront/custom domain output                   | M4 + M5        | Trước tuần 5    |
| Quyền ghi biên bản            | SRS cho phép cấu hình; cần rule MVP cụ thể              | M2 + M3        | Tuần 2            |
| Quyền tạo/giao task            | Chốt admin-only hay quyền được ủy quyền                | M2 + M3        | Tuần 2            |
| Khi Google integration lỗi      | Chốt retry limit, trạng thái và UX action                 | M3 + M4        | Trước tuần 5    |
| Ngày khóa scope MVP            | Không thêm feature ngoài SRS sau mốc                      | Cả nhóm      | Cuối tuần 1      |
| DynamoDB access pattern/index    | Placeholder hiện chưa phải database design hoàn chỉnh    | M3 + M5        | Trước tuần 2    |
| CORS/domain/retention/PITR       | Chốt theo môi trường và budget                           | M5 + cả nhóm | Trước deploy dev |
| Google artifact strategy          | Đã chốt: Calendar tạo lịch; Meet REST sync khi có; upload/capture fallback; polling AWS cho MVP | M4 + M5 | Đã chốt, kiểm tra lại khi implement |
| Recording consent/capture         | Chốt nội dung consent, nguồn micro/tab/system audio, chỉ báo, stop và retention               | M1 + M2 + M3 | Trước tuần 6 |
| Upload allowlist/size/scan         | Chốt file MVP; PDF/TXT/DOCX/audio trước, định dạng nâng cao sau                               | M3 + M5 | Trước tuần 6 |
| STT provider tiếng Việt           | Amazon Transcribe mặc định; benchmark Deepgram trên cùng tập audio trước khi khóa adapter      | M4 + M5 | Đầu tuần 7 |
| AI model/Region                   | Chọn model Bedrock hỗ trợ Region và tool/citation; model ID là env config                       | M4 + M5 | Trước tuần 7 |
| Grounding/citation                | Chốt citation schema và test không đủ nguồn/chéo nhóm                                           | M3 + M4 | Trước tuần 7 |
| AI mutation policy                | Chỉ `ToolProposal`; schema + auth + preview + confirm + idempotency + audit                     | M1 + M3 + M4 | Trước pha AI-2 |
| AI retention/cost                 | Chốt audio/transcript/conversation/vector TTL và quota token/phút                               | M3 + M5 | Trước deploy AI |
