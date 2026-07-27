# Kế hoạch triển khai CampusMeet cho nhóm 5 người

Kế hoạch này chuyển CampusMeet từ scaffold sang các vertical slice có thể demo. Phạm vi nghiệp vụ do [SRS](CampusMeet-SRS.md) quyết định; thiết kế vật lý DynamoDB do [data foundation](huong-dan-data-foundation.md) làm source of truth.

## 1. Baseline đã có

- Auth Cognito đã hoàn thành ở mức integration: đăng ký, xác nhận email, đăng nhập, đăng xuất và protected route.
- Auth integration stack thử nghiệm trước đó đã cleanup.
- 17 bảng DynamoDB `campusmeet-dev-*` đã được tạo trong account `604360241374`, Region `ap-southeast-1`.
- `infra/data-foundation.yaml` mô tả 17 bảng, nhưng CloudFormation ownership chỉ được xác nhận sau verify và import/recreate.
- Backend nghiệp vụ vẫn là skeleton; bảng tồn tại không có nghĩa API đã persistence thật.
- Frontend nghiệp vụ vẫn dùng mock ở các luồng chưa triển khai.

## 2. Quy tắc làm việc chung

- Mỗi người dùng branch và Pull Request riêng; không code trực tiếp hoặc force-push vào `main`.
- Một PR giải quyết một outcome rõ ràng và phải qua quality gates.
- Không commit `.env`, credential, token, password, access key hoặc dữ liệu người dùng thật.
- Không dùng chung IAM user; mỗi thành viên dùng tài khoản riêng trong group `CampusMeetDevelopers`.
- Không tạo/sửa/xóa DynamoDB table bằng Console khi IaC đã là owner.
- Mọi request group-scoped phải kiểm tra membership/role ở backend.
- Frontend không phải authorization boundary.
- Shared DTO/type phải được cập nhật trước hoặc cùng backend/frontend consumer.
- Không triển khai nhiều feature dở dang song song chỉ để có nhiều màn hình.

## 3. Phân công ownership

| Thành viên | Outcome chính | Phối hợp bắt buộc |
| --- | --- | --- |
| M1 | Group, membership và invitation | M2–M5 dùng `groupId`; M5 review DynamoDB/IAM |
| M2 | Meeting, agenda, attendee, organizer và lifecycle | M1 cung cấp membership; M4 dùng meeting lifecycle |
| M3 | Minutes, task và dashboard | M1 cung cấp member/assignee; M2 cung cấp `meetingId` |
| M4 | Google OAuth, Calendar/Meet, reminder và notification delivery | M2 chốt lifecycle; M5 review secret/runtime |
| M5 | Data/infra review, upload, recording, transcript, AI, monitoring và cleanup | M1 kiểm tra ACL; M2/M3 cung cấp source/contract |

Auth là nền tảng dùng chung đã có, không giao lại thành một feature riêng. Ownership là trách nhiệm về outcome; owner vẫn cần review của người cung cấp contract hoặc hạ tầng liên quan.

## 4. Thứ tự triển khai bắt buộc

```text
Data foundation verification
  -> Group + Membership
  -> Invitation
  -> Meeting nội bộ
  -> Minutes + Task + Dashboard
  -> Google Calendar/Meet
  -> Reminder + Notification
  -> Upload + Recording + Transcript
  -> Bedrock/RAG/ToolProposal
  -> Hosting + Observability + Demo hardening
```

Không bắt đầu Google/AI trước khi authorization và các entity nguồn chạy bằng dữ liệu thật.

## 5. Giai đoạn 0 — Xác minh data foundation

Owner: M5, M1–M4 review access patterns của feature mình.

### Việc cần làm

1. Chạy:

```powershell
.\scripts\verify-data-foundation.ps1 `
  -Profile <aws-profile> `
  -Region ap-southeast-1 `
  -Environment dev
```

2. So sánh 17 bảng thật với `infra/data-foundation.yaml`:
   - table name;
   - partition/sort key;
   - GSI;
   - billing mode;
   - TTL;
   - PITR/deletion protection;
   - tags.
3. Chọn CloudFormation resource import hoặc recreate có kiểm soát.
4. Không deploy create trực tiếp vào tên bảng đã tồn tại.
5. Lưu evidence không chứa credential hoặc dữ liệu nhạy cảm.

### Hoàn thành khi

- verify schema pass;
- CloudFormation ownership/drift được xác định rõ;
- IAM developer chỉ đọc/ghi item đúng `campusmeet-dev-*`;
- README, architecture và runbook cùng mô tả một trạng thái.

## 6. Giai đoạn 1 — Group và Membership

Owner: M1. M5 review transaction, index và IAM.

### Vertical slice đầu tiên

```text
Cognito identity
  -> POST /groups
  -> validate input
  -> write Groups
  -> write Memberships(GROUP_ADMIN)
  -> write safe audit record
  -> GET /groups
```

### File thường sửa

- `packages/shared/src/types/`
- `packages/shared/src/dto/`
- `apps/web/src/features/groups/`
- `services/api/src/handlers/groups.ts`
- `services/api/src/application/groups.ts`
- `services/api/src/repositories/`
- tests và `docs/api-contract.md`

### Test bắt buộc

- tạo nhóm hợp lệ;
- tên nhóm không hợp lệ bị từ chối;
- creator trở thành active Group Admin;
- retry không tạo group/membership trùng;
- user ngoài nhóm không đọc được dữ liệu;
- `GET /groups` chỉ trả membership active.

## 7. Giai đoạn 2 — Invitation

Owner: M1.

- Lưu `tokenHash`, không lưu raw token.
- Invitation có status và expiry rõ ràng.
- Accept dùng conditional write/idempotency.
- Không tạo membership trùng.
- Expired/revoked invitation bị từ chối bằng error code ổn định.

## 8. Giai đoạn 3 — Meeting nội bộ

Owner: M2. Chưa phụ thuộc Google.

### Luồng

```text
Group Admin
  -> create/update/cancel meeting
  -> validate organizer/attendee active
  -> persist meeting
  -> query theo group + startAtUtc
```

### Test bắt buộc

- end time sau start time;
- organizer và attendee thuộc group, đang active;
- cancel idempotent và không hard-delete;
- user nhóm khác nhận `403`;
- UTC storage và timezone display không lẫn lộn.

## 9. Giai đoạn 4 — Minutes, Task và Dashboard

Owner: M3.

- Một minutes chính theo `meetingId`.
- Action item có thể tạo task nhưng phải qua xác nhận.
- Assignee phải là active member.
- `DONE` lưu `completedAt`; mở lại xử lý trường này nhất quán.
- Overdue được tính, không lưu thành status riêng.
- Dashboard lấy số liệu backend, không tổng hợp bảo mật ở client.

Acceptance end-to-end:

```text
meeting hoàn thành
  -> minutes
  -> task
  -> update DONE
  -> dashboard thay đổi
```

## 10. Giai đoạn 5 — Google Calendar và Meet

Owner: M4. M2 review lifecycle, M5 review secret/runtime.

- OAuth token chỉ lưu server-side.
- Meeting nội bộ được lưu trước khi gọi Google.
- `googleSyncStatus` độc lập `meetingStatus`.
- Retry có giới hạn và idempotent; không tạo event/link trùng.
- Chỉ hiển thị Meet link khi `READY`.
- Meet REST sync artifact khi có quyền và artifact tồn tại.
- Khi Google lỗi/không có artifact, luồng nội bộ vẫn hoạt động và có upload/capture fallback.

## 11. Giai đoạn 6 — Reminder và Notification

Owner: M4, M5 review Scheduler/SES/IAM.

- One-time schedule có tên/idempotency key ổn định.
- Meeting hủy phải vô hiệu reminder còn hiệu lực.
- Reminder Lambda kiểm tra trạng thái meeting lần cuối.
- Tạo in-app notification trước; SES failure không rollback dữ liệu.
- Retry không gửi trùng ngoài chính sách đã chốt.

## 12. Giai đoạn 7 — Upload, Recording và Transcript

Owner: M5, M1 review ACL/consent, M2 cung cấp meeting.

- Upload qua presigned URL; file lớn không đi qua API Gateway.
- MIME/extension/size/checksum được kiểm tra.
- File/audio nằm ở S3 private; DynamoDB lưu metadata/reference.
- Recording chỉ bắt đầu sau consent rõ ràng và lưu source metadata.
- STT tạo speaker label ẩn danh; không tự suy đoán danh tính.
- Transcript edit lưu version, editor và timestamp.

## 13. Giai đoạn 8 — AI

Owner: M5, M1–M3 review ACL và mutation contract.

- Job dài chạy bất đồng bộ qua `AIJob`.
- Bedrock output là draft có citation.
- Retrieval filter `groupId`/ACL trước khi model nhận dữ liệu.
- Không đủ nguồn thì trả lời không xác định.
- Tool use chỉ tạo `ToolProposal`.
- Mutation chỉ chạy sau schema validation, authorization, preview, confirm, idempotency và audit.
- Không log prompt, transcript hoặc token nhạy cảm.

## 14. Git và Pull Request

Branch mẫu:

```text
feat/groups-create
feat/meetings-internal
fix/invitation-idempotency
test/cross-group-authorization
chore/data-foundation-import
docs/aws-runbook
```

PR phải ghi:

- mục tiêu/outcome;
- file/vertical slice chính;
- cách kiểm thử;
- security/data impact;
- IAM/schema/migration impact;
- evidence an toàn;
- rollback/cleanup;
- phần chưa hoàn thành.

Trước merge:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run format:check
```

PR data/infra chạy thêm template validation và data verification phù hợp.

## 15. Definition of done

Một vertical slice chỉ hoàn thành khi:

- UI gọi API thật hoặc API có client/test chứng minh được;
- backend validation và authorization hoạt động;
- persistence thật chạy qua repository;
- happy path và failure/authorization path có test;
- error contract ổn định;
- không còn mock/`501` trong phạm vi slice;
- docs/API contract cập nhật;
- PR review và CI pass;
- không có secret;
- deploy/change set/cleanup impact được ghi khi liên quan AWS.

## 16. Các quyết định đã chốt

| Nội dung | Quyết định |
| --- | --- |
| AWS account dev | `604360241374` |
| AWS Region dev | `ap-southeast-1` — Asia Pacific (Singapore) |
| DynamoDB prefix | `campusmeet-dev` |
| Data model MVP | 17 multi-table domain tables theo `infra/data-foundation.yaml` |
| Billing | `PAY_PER_REQUEST` |
| Team access | 5 IAM user riêng, một group `CampusMeetDevelopers`, không dùng chung credential |
| Developer permissions | Đọc/ghi item đúng prefix; không đổi schema, IAM hoặc Billing |
| Google strategy | Calendar tạo lịch/Meet; REST sync artifact khi có; upload/capture fallback |
| Product surface | CampusMeet web là chính; Meet Add-on là surface bổ sung |
| AI mutation | Chỉ `ToolProposal` rồi confirm qua API nghiệp vụ |
| STT | Amazon Transcribe `vi-VN` mặc định; benchmark adapter khác sau |

## 17. Quyết định còn phải chốt trước từng pha

- M1–M5 là tên thành viên thật nào.
- Rule cụ thể cho quyền ghi minutes và tạo/giao task.
- CORS/domain của môi trường deploy.
- PITR, deletion protection, backup và retention theo budget.
- SES sender/recipient và sandbox exit.
- Upload allowlist/size/scan.
- Recording consent text và retention.
- Bedrock model/Region/quota.
- CloudTrail DynamoDB data events có bật hay không và ngân sách tương ứng.
