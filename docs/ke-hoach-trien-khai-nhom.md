# Kế hoạch triển khai CampusMeet cho nhóm 5 người

Kế hoạch này chuyển CampusMeet từ scaffold sang vertical slice chạy được. Phạm vi nghiệp vụ do [SRS](CampusMeet-SRS.md) quyết định; M5 chi tiết tại [kế hoạch upload/transcript/AI](ke-hoach-m5-upload-transcript-ai.md).

## 1. Baseline hiện tại

- Auth Cognito đã được xác minh ở mức integration: sign-up, confirmation, sign-in, sign-out và protected route.
- Auth integration stack thử nghiệm trước đó đã cleanup.
- 17 bảng DynamoDB `campusmeet-dev-*` đã được tạo trong account `604360241374`, Region `ap-southeast-1`.
- Data manifest nằm tại `infra/data-foundation.spec.json`; CloudFormation ownership chưa hoàn tất cho đến khi verify/import.
- Backend nghiệp vụ còn skeleton; bảng tồn tại không đồng nghĩa API đã persistence thật.
- Frontend nghiệp vụ vẫn dùng mock ở slice chưa triển khai.
- M5 baseline đã chốt: live transcription sau consent, upload trực tiếp S3, transcript/citation, RAG current/selected/whole-group trong cùng `groupId`, không nhận diện speaker và không mutation khi chưa xác nhận.

## 2. Quy tắc chung

- Không code trực tiếp hoặc force-push `main`.
- Một branch/PR giải quyết một outcome nhỏ.
- Contract đổi trước hoặc cùng backend/frontend consumer.
- Không commit `.env`, secret, token, password, access key hoặc dữ liệu người dùng.
- Mỗi thành viên dùng IAM user riêng và MFA.
- Frontend không quyết định authorization.
- Mọi request group-scoped kiểm tra membership/role ở backend.
- Không sửa/xóa table bằng Console khi IaC đã là owner.
- Không bắt đầu Google/AI mutation trước khi group/meeting authorization chạy bằng dữ liệu thật.

## 3. Ownership

| Thành viên | Outcome chính | Phối hợp bắt buộc |
| --- | --- | --- |
| M1 | Group, membership, invitation | M5 review data/IAM; M2–M5 dùng `groupId` |
| M2 | Meeting, agenda, attendee, organizer, lifecycle | M1 membership; M4 Google |
| M3 | Minutes, task, dashboard | M1 assignee; M2 `meetingId`; M5 nhận/sinh draft theo contract |
| M4 | Google OAuth/Calendar/Meet, reminder/notification | M2 lifecycle; M5 secret/runtime |
| M5 | Data/infra review, upload, live transcript, RAG/AI, monitoring/cleanup | M1 ACL; M2 meeting; M3 minutes/task |

Auth là nền tảng dùng chung đã có, không giao lại thành feature độc lập.

## 4. Thứ tự bắt buộc

```text
Data foundation verify/import
  -> Group + Membership
  -> Invitation
  -> Meeting nội bộ
  -> Minutes + Task + Dashboard
  -> Google Calendar/Meet
  -> Reminder + Notification
  -> Upload + Live Transcript
  -> RAG/AI
  -> Hosting + Observability + Demo hardening
```

## 5. Giai đoạn 0 — Data foundation

Owner: M5; M1–M4 review access pattern feature mình.

```powershell
npm run infra:prepare:data
npm run infra:check
npm run sam:validate:data
npm run aws:verify:data -- -Profile <aws-profile>
```

Hoàn thành khi:

- đủ 17 bảng, `ACTIVE`, `PAY_PER_REQUEST`;
- primary key/GSI khớp manifest;
- import/recreate plan được review;
- CloudFormation drift được xác định;
- developer IAM chỉ read/write item đúng prefix;
- docs cùng mô tả một trạng thái.

## 6. M1 — Group, Membership, Invitation

Vertical slice đầu tiên:

```text
Cognito identity
  -> POST /groups
  -> validate
  -> Groups + Memberships(GROUP_ADMIN)
  -> safe audit
  -> GET /groups qua UserMembershipsIndex
```

Files thường sửa:

- `packages/shared/src/types/`
- `packages/shared/src/dto/`
- `apps/web/src/features/groups/`
- `services/api/src/handlers/groups.ts`
- `services/api/src/application/groups.ts`
- `services/api/src/repositories/`
- tests và `docs/api-contract.md`

Tests:

- create group hợp lệ;
- tên không hợp lệ bị từ chối;
- creator là active Group Admin;
- retry không tạo record trùng;
- user ngoài nhóm nhận `403`;
- không xóa admin cuối cùng;
- invitation accept idempotent, expired/revoked bị từ chối.

## 7. M2 — Meeting nội bộ

Chưa phụ thuộc Google.

```text
Group Admin
  -> create/update/cancel meeting
  -> validate organizer/attendee active
  -> persist
  -> query group + startAtUtc
```

Tests:

- end time sau start time;
- organizer/attendee thuộc nhóm;
- cancel idempotent, không hard-delete;
- cross-group `403`;
- UTC storage/timezone display đúng.

## 8. M3 — Minutes, Task, Dashboard

- Một minutes chính theo `meetingId`.
- Action item có thể tạo task nhưng cần quyền/xác nhận.
- Assignee là active member.
- `DONE` lưu `completedAt`; mở lại xử lý nhất quán.
- Overdue là giá trị tính toán.
- Dashboard lấy số liệu backend, không tính bảo mật ở client.

Acceptance:

```text
meeting hoàn thành
  -> minutes
  -> task
  -> DONE
  -> dashboard thay đổi
```

## 9. M4 — Google Calendar/Meet và Reminder

Google:

- OAuth token chỉ server-side.
- Meeting nội bộ lưu trước khi gọi Google.
- `meetingStatus` và `googleSyncStatus` độc lập.
- Retry idempotent, không tạo event/link trùng.
- Meet link chỉ hiện khi `READY`.
- Artifact không có là kết quả hợp lệ; dùng upload/capture fallback.

Reminder:

- one-time schedule có idempotency key;
- meeting hủy không gửi reminder;
- Reminder Lambda kiểm tra trạng thái lần cuối;
- in-app notification tạo trước;
- SES failure không rollback dữ liệu.

## 10. M5 — Upload, Live Transcript và RAG/AI

M5 tuân theo tài liệu riêng, với các yêu cầu bắt buộc:

- consent/cấp quyền capture rõ ràng;
- live transcription chạy nền trong phiên đã đồng ý;
- ưu tiên chất lượng tiếng Việt, speaker label ẩn danh;
- không speaker identity/biometric;
- file/audio upload trực tiếp S3 bằng presigned URL;
- binary không đi qua API Gateway/Lambda payload;
- `AIJob` bất đồng bộ;
- transcript có timestamp/confidence/version;
- người có quyền sửa transcript;
- RAG `CURRENT_MEETING`, `SELECTED_MEETINGS`, `WHOLE_GROUP` nhưng mỗi query chỉ thuộc một `groupId`;
- filter group/meeting-set/ACL/source status trước retrieval;
- citation bắt buộc; thiếu nguồn trả `insufficientContext`;
- minutes/action-item/task proposal là draft;
- mutation cần preview, authorization, confirmation và idempotency;
- không chấm điểm/xếp hạng cá nhân;
- retention/cost/cleanup xuyên S3, DynamoDB, Knowledge Base và vectors.

## 11. Kế hoạch 8 tuần

| Tuần | Trọng tâm | Mốc |
| --- | --- | --- |
| 1 | Baseline, data verify/import, contract/Git workflow | 5 máy quality gates pass; data status rõ |
| 2 | Group + Membership | UI → API → DynamoDB; authorization test |
| 3 | Invitation + Meeting nội bộ | MVP core 1 chạy end-to-end |
| 4 | Minutes + Task + Dashboard | MVP core 2 chạy end-to-end |
| 5 | Google integration | pending/ready/retry/action-required; không link giả |
| 6 | Reminder + upload/data AI | hủy meeting không gửi; binary không qua API |
| 7 | Live transcript + RAG/AI + observability | transcript/citation/RAG trong cùng group; alarm/cost |
| 8 | Security/failure tests, demo, cleanup rehearsal | core + AI MVP pass; evidence hoàn chỉnh |

Ba mốc demo bắt buộc:

1. Group → invitation → membership → meeting nội bộ.
2. Meeting → minutes → task → `DONE` → dashboard.
3. Consent → live transcript → edit → draft/citation → RAG cùng group, không rò chéo nhóm.

## 12. Git/PR

Branch:

```text
feat/groups-create
feat/meetings-internal
fix/invitation-idempotency
test/cross-group-authorization
chore/data-foundation-import
docs/aws-runbook
```

PR phải ghi:

- outcome;
- thay đổi chính;
- cách kiểm thử;
- security/data impact;
- IAM/schema/migration impact;
- evidence;
- rollback/cleanup;
- phần chưa hoàn thành.

Quality gates:

```powershell
npm run infra:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run format:check
```

## 13. Definition of done

Một slice chỉ hoàn thành khi:

- UI/API hoặc client/test chứng minh được;
- validation + authorization;
- persistence/adapter thật trong phạm vi slice;
- happy path + failure/permission test;
- error contract ổn định;
- không còn mock/`501` trong phạm vi;
- docs/API contract cập nhật;
- CI/review pass;
- không có secret;
- AWS impact/rollback/cleanup được ghi.

## 14. Quyết định đã chốt

| Nội dung | Quyết định |
| --- | --- |
| AWS account dev | `604360241374` |
| AWS Region dev | `ap-southeast-1` |
| DynamoDB prefix | `campusmeet-dev` |
| Data model | 17 multi-table definitions trong `infra/data-foundation.spec.json` |
| Billing | `PAY_PER_REQUEST` |
| Team AWS access | 5 IAM user riêng, group `CampusMeetDevelopers` |
| Developer permissions | Item read/write đúng prefix; không schema/IAM/Billing |
| Google | Calendar tạo event/Meet; REST artifact khi có; fallback upload/capture |
| Product surface | CampusMeet web là chính; Meet Add-on bổ sung |
| STT | Multilingual adapter, ưu tiên benchmark tiếng Việt |
| RAG | Current/selected/whole-group trong cùng `groupId` |
| AI mutation | Draft/proposal → preview/confirm qua API nghiệp vụ |

## 15. Còn phải chốt theo pha

- tên thật M1–M5;
- quyền ghi minutes và tạo/giao task;
- CORS/domain;
- PITR/deletion protection/backups;
- SES sender/sandbox;
- upload allowlist/size/scan;
- consent text/capture source/retention;
- Bedrock model/Region/quota;
- CloudTrail DynamoDB data events và ngân sách.
