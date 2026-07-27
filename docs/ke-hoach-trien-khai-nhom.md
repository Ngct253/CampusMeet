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

| Thành viên | Chức năng độc lập              | Đầu ra bàn giao                                                                                                                                                                                                            | Phối hợp bắt buộc                                                 |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| M1         | Nhóm và thành viên             | Group CRUD, membership, invitation, vai trò Admin/Member và kiểm tra quyền                                                                                                                                                 | M2–M5 dùng`groupId`; M5 hỗ trợ tài nguyên DynamoDB                |
| M2         | Quản lý cuộc họp               | Meeting CRUD, agenda, attendee, organizer, trạng thái cuộc họp và lịch                                                                                                                                                     | M1 cung cấp membership; M4 dùng meeting lifecycle                 |
| M3         | Biên bản, công việc, dashboard | Minutes, decision, action item, task status và dashboard tiến độ                                                                                                                                                           | M1 cung cấp member/assignee; M2 cung cấp`meetingId`               |
| M4         | Google Calendar và Meet        | Google OAuth, Calendar event, Meet link,`googleSyncStatus`, retry và artifact sync fallback                                                                                                                                | M2 chốt lifecycle; M5 hỗ trợ secret/runtime                       |
| M5         | Upload, transcript và AI       | Live transcription chạy nền trong mọi cuộc họp, presigned upload, Attachment/AIJob, transcript editor, biên bản diễn biến và RAG theo meeting bằng Knowledge Bases/S3 Vectors, Bedrock Q&A/citation, monitoring và cleanup | M1 kiểm tra quyền; M2 cung cấp meeting; M3 nhận bản nháp biên bản |

Ownership là người chịu trách nhiệm chính về outcome, không có nghĩa một người phải tự làm toàn bộ code. Mọi integration phải qua API contract và Pull Request.

Auth đăng ký/đăng nhập đã hoàn thành và là nền tảng dùng chung, không giao lại cho một thành viên. Mỗi owner tự làm UI, API, dữ liệu, validation, test và phần IaC tối thiểu của chức năng mình; M5 review thay đổi AWS chung nhưng không viết thay toàn bộ IaC cho nhóm.

## 2.1 Công việc chi tiết theo chức năng

### M1 — Nhóm và thành viên

Mục tiêu: người đã đăng nhập tạo được nhóm, xem nhóm, mời người khác và quản lý thành viên bằng dữ liệu thật.

| Loại             | File/thư mục                                                                                           | Việc cần làm                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Contract         | `packages/shared/src/dto/index.ts`, `types/index.ts`, `enums/index.ts`                                 | Hoàn thiện`CreateGroupRequest`, `Group`, `Membership`, `Invitation`, role/status |
| Frontend         | `apps/web/src/features/groups/pages/GroupPages.tsx`                                                    | Thay mock bằng form/list/detail thật; loading, empty, error và permission state  |
| Frontend service | `apps/web/src/features/groups/service.ts`                                                              | Gọi Group/Membership/Invitation API qua API client dùng chung                    |
| Backend          | `services/api/src/handlers/groups.ts`                                                                  | Route Group CRUD, membership và invitation; handler chỉ parse/trả response       |
| Application/data | Tạo`services/api/src/application/groups.ts` và repository group trong `services/api/src/repositories/` | Validation, rule không xóa Admin cuối cùng, đọc/ghi DynamoDB                     |
| Test             | Tạo test cạnh service/handler hoặc trong`services/api/tests/`                                          | Tạo nhóm thành công; member nhóm khác nhận`403`; invitation hết hạn bị từ chối   |
| Tài liệu         | `docs/api-contract.md`                                                                                 | Cập nhật endpoint và trạng thái sau khi code chạy                                |

Tiêu chí bàn giao: đăng nhập → tạo nhóm → mời tài khoản khác → chấp nhận → xem danh sách thành viên; có test quyền chéo nhóm.

Trình tự M1 thực hiện:

1. Mở `packages/shared/src/types/index.ts` để đọc kiểu `Group`, `Membership`; bổ sung các trường còn thiếu như mã nhóm, tên, mô tả, vai trò, trạng thái và thời gian tạo. Không tạo kiểu dữ liệu trùng ở frontend.
2. Mở `packages/shared/src/dto/index.ts` để định nghĩa dữ liệu frontend gửi khi tạo nhóm/mời thành viên. Quy định rõ trường bắt buộc, độ dài tên nhóm và định dạng email.
3. Trong `GroupPages.tsx`, thay danh sách mock bằng dữ liệu lấy từ `service.ts`; thêm form tạo nhóm và khu vực quản lý thành viên. Người dùng phải thấy thông báo cụ thể khi đang tải, chưa có nhóm, nhập sai hoặc không đủ quyền.
4. Trong `service.ts`, viết các hàm như lấy danh sách nhóm, tạo nhóm, lấy thành viên và gửi lời mời. Tất cả phải dùng `api-client.ts`, không gọi `fetch` rải rác trong component.
5. Trong backend, tách xử lý nghiệp vụ sang `application/groups.ts`; `handlers/groups.ts` chỉ đọc request, gọi application service và trả HTTP response.
6. Repository nhóm chịu trách nhiệm đọc/ghi DynamoDB. Trước mọi thao tác theo `groupId`, kiểm tra người gọi có membership đang hoạt động; thao tác quản trị phải kiểm tra vai trò Admin.
7. Kiểm tra ba tình huống: tạo nhóm hợp lệ; tên nhóm trống bị từ chối; tài khoản không thuộc nhóm không thể xem dữ liệu. Chụp màn hình và lưu kết quả test cho PR.

### M2 — Quản lý cuộc họp

Mục tiêu: quản trị viên tạo, sửa, hủy và xem cuộc họp nội bộ, chưa phụ thuộc Google.

| Loại             | File/thư mục                                                                                               | Việc cần làm                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Contract         | `packages/shared/src/dto/index.ts`, `types/index.ts`, `enums/index.ts`                                     | Chốt meeting request/response,`MeetingStatus`, agenda, attendee và organizer |
| Frontend         | `apps/web/src/features/meetings/pages/MeetingPages.tsx`                                                    | Form tạo/sửa, danh sách, chi tiết, hủy và trạng thái cuộc họp                |
| Frontend service | `apps/web/src/features/meetings/service.ts`                                                                | Gọi Meeting API; không gọi Google trực tiếp từ UI                            |
| Backend          | `services/api/src/handlers/meetings.ts`                                                                    | Meeting CRUD và cancel endpoint                                              |
| Application/data | Tạo`services/api/src/application/meetings.ts` và repository meeting trong `services/api/src/repositories/` | Kiểm tra member/organizer, thời gian, attendee active và lifecycle           |
| Test             | Tạo test meeting frontend/backend                                                                          | Không chọn member inactive; hủy meeting idempotent; group khác nhận`403`     |
| Tài liệu         | `docs/api-contract.md`                                                                                     | Chốt path parameter và cập nhật endpoint thật                                |

Tiêu chí bàn giao: tạo nhóm có sẵn → tạo/sửa/hủy meeting → danh sách và chi tiết cập nhật bằng dữ liệu thật.

Trình tự M2 thực hiện:

1. Đọc rule cuộc họp trong SRS, sau đó hoàn thiện kiểu dữ liệu trong `packages/shared`: tiêu đề, nội dung, thời gian bắt đầu/kết thúc, người tổ chức, người tham dự và trạng thái.
2. Trong `MeetingPages.tsx`, làm form tạo/sửa cuộc họp. Người tổ chức và người tham dự chỉ được chọn từ danh sách thành viên đang hoạt động do API của M1 cung cấp.
3. Trong `service.ts`, tạo các hàm lấy danh sách, lấy chi tiết, tạo, sửa và hủy cuộc họp. Ngày giờ gửi lên API phải theo UTC; giao diện hiển thị theo múi giờ người dùng.
4. Trong `application/meetings.ts`, kiểm tra thời gian kết thúc phải sau thời gian bắt đầu, organizer thuộc nhóm và attendee còn hoạt động.
5. “Hủy” chỉ đổi trạng thái cuộc họp, không xóa dữ liệu. Gửi yêu cầu hủy lại lần hai phải cho cùng kết quả, không tạo lỗi hoặc bản ghi phụ.
6. Chưa gọi Google Calendar trong luồng này. Chỉ lưu meeting nội bộ và để M4 nhận meeting hợp lệ qua contract đã thống nhất.
7. Kiểm tra ba tình huống: tạo/sửa thành công; chọn thành viên không hoạt động bị từ chối; người thuộc nhóm khác nhận `403`.

### M3 — Biên bản, công việc và dashboard

Mục tiêu: hoàn thành luồng sau họp từ biên bản đến task và số liệu tiến độ.

| Loại             | File/thư mục                                                                                                  | Việc cần làm                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Contract         | `packages/shared/src/dto/index.ts`, `types/index.ts`, `enums/index.ts`                                        | Chốt Minutes, Decision, ActionItem, Task và Dashboard DTO                        |
| Frontend         | `apps/web/src/features/tasks/pages/TasksPage.tsx`, `apps/web/src/features/dashboard/pages/DashboardPages.tsx` | Form task, lọc/trạng thái, overdue và dashboard                                  |
| Frontend service | `apps/web/src/features/tasks/service.ts`, `apps/web/src/features/dashboard/service.ts`                        | Gọi API task/dashboard và bỏ mock khỏi luồng hoàn chỉnh                          |
| Backend          | `services/api/src/handlers/minutes.ts`, `tasks.ts`, `dashboard.ts`                                            | Minutes CRUD, chuyển action item thành task, update status và aggregate          |
| Application/data | Tạo các service tương ứng trong`services/api/src/application/` và repository                                  | Kiểm tra assignee active; lưu`completedAt`; tính overdue thay vì lưu status mới  |
| Test             | Test minutes/task/dashboard                                                                                   | Action item tạo task; chuyển`DONE` làm dashboard thay đổi; group khác nhận `403` |
| Tài liệu         | `docs/api-contract.md`                                                                                        | Ghi endpoint và quy tắc tính dashboard                                           |

Tiêu chí bàn giao: meeting hoàn thành → tạo biên bản → tạo task → cập nhật `DONE` → dashboard thay đổi.

Trình tự M3 thực hiện:

1. Chốt cấu trúc biên bản gồm tóm tắt, nội dung thảo luận, quyết định và việc cần làm; chốt task gồm tiêu đề, người phụ trách, hạn hoàn thành và trạng thái.
2. Tạo phần nhập/xem biên bản gắn với `meetingId`. Khi người dùng chọn một action item để chuyển thành task, phải giữ liên kết về biên bản nguồn.
3. Trong `TasksPage.tsx`, thay mock bằng dữ liệu API; cho phép lọc theo trạng thái/người phụ trách và cập nhật `TODO`, `IN_PROGRESS`, `DONE`.
4. Trong backend, chỉ cho giao task cho thành viên đang hoạt động. Khi chuyển sang `DONE`, lưu `completedAt`; khi mở lại task, xử lý lại trường này theo rule đã chốt.
5. Dashboard lấy số liệu từ API: tổng task, task hoàn thành, đang làm và quá hạn. “Quá hạn” được tính từ hạn hoàn thành và trạng thái hiện tại, không tạo thêm trạng thái `OVERDUE`.
6. Không để AI ghi thẳng biên bản hoặc task. Kết quả AI của M5 chỉ là bản nháp để người dùng xem và xác nhận.
7. Kiểm tra luồng đầy đủ: tạo biên bản → tạo task → đánh dấu hoàn thành → số trên dashboard thay đổi; thêm test người ngoài nhóm không đọc được biên bản.

### M4 — Google Calendar và Meet

Mục tiêu: meeting nội bộ đồng bộ được Calendar/Meet mà không làm hỏng luồng khi Google lỗi.

| Loại       | File/thư mục                                                                  | Việc cần làm                                                                                 |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Contract   | `packages/shared/src/dto/index.ts`, `types/index.ts`, `enums/index.ts`        | Tách`GoogleSyncStatus` khỏi `MeetingStatus`; chốt connect/callback/sync response             |
| Frontend   | Tạo`apps/web/src/features/integrations/` và bổ sung trạng thái vào Meeting UI | Connect Google, pending/ready/action-required/failed và retry                                |
| Backend    | `services/api/src/handlers/integrations.ts`                                   | OAuth start/callback/disconnect và sync action                                               |
| Adapter    | `services/api/src/integrations/adapters.ts` hoặc tách `google-calendar.ts`    | Calendar create/update/delete, Meet conference request và artifact adapter                   |
| Secret/IaC | `infra/template.yaml`, `infra/parameters.example.json`                        | Chỉ tham chiếu secret; không commit client secret; cấu hình redirect URI                     |
| Test       | Mock Google adapter                                                           | Retry không tạo event trùng; thiếu artifact dùng fallback; không hiện Meet link trước`READY` |
| Tài liệu   | `docs/api-contract.md`, `docs/huong-dan-trien-khai-aws.md`                    | Ghi redirect URI, scopes và trạng thái sync                                                  |

Tiêu chí bàn giao: meeting nội bộ → đồng bộ Calendar → nhận Meet link; lỗi Google có trạng thái rõ và retry idempotent.

Trình tự M4 thực hiện:

1. Tạo cấu hình OAuth trên Google Cloud theo tài liệu nhóm: callback local và callback môi trường deploy phải khớp tuyệt đối; client secret chỉ lưu trong kho secret AWS.
2. Tạo nút “Kết nối Google” và các trạng thái tiếng Việt: chưa kết nối, đang đồng bộ, đã sẵn sàng, cần kết nối lại và đồng bộ thất bại.
3. Backend nhận authorization code từ callback, đổi token ở server và lưu token an toàn; không gửi refresh token về frontend hoặc ghi token vào log.
4. Khi meeting của M2 hợp lệ, adapter tạo/cập nhật/hủy Calendar Event. Dùng khóa chống trùng để bấm thử lại không tạo hai event.
5. Chỉ lưu và hiển thị Meet link khi `googleSyncStatus` là `READY`. Trạng thái cuộc họp và trạng thái đồng bộ Google là hai trường riêng.
6. Nếu Google không trả recording/transcript, đây là kết quả hợp lệ; giao diện hướng người dùng sang upload thủ công của M5.
7. Dùng adapter giả trong test để mô phỏng Google thành công, timeout và token hết hạn. Không cần gọi Google thật trong test tự động.

### M5 — Upload, transcript và AI

Mục tiêu: live transcription chạy nền trong mọi phiên họp sau consent/cấp quyền là nguồn duy nhất của nội dung phát biểu; file bổ sung đi thẳng lên S3; hệ thống tạo biên bản chỉ ghi diễn biến và trả lời có citation trong meeting hiện tại dựa trên tài liệu cuộc họp cùng biên bản đã duyệt. Kế hoạch triển khai chi tiết nằm tại [Kế hoạch M5 — Upload, Voice Transcript và Hỏi đáp theo cuộc họp](ke-hoach-m5-upload-transcript-ai.md).

| Loại             | File/thư mục                                                           | Việc cần làm                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Contract         | `packages/shared/src/dto/index.ts`, `types/index.ts`, `enums/index.ts` | Attachment, AIJob, TranscriptSegment, MeetingChatRequest, GroundedAnswer, bản nháp biên bản diễn biến và citation                    |
| Frontend         | Tạo`apps/web/src/features/attachments/`, `transcripts/`, `ai/`         | Upload progress, job status, transcript editor/speaker mapping, biên bản diễn biến và citation UI theo meeting                       |
| Backend          | Tạo handler attachment/transcript/AI trong`services/api/src/handlers/` | Presigned URL, complete upload, job status, transcript patch và chat                                                                 |
| Application/data | Tạo service/repository tương ứng                                       | MIME/size/checksum, consent, ACL`groupId`/`meetingId`, version transcript và citation                                                |
| AWS              | `infra/template.yaml`                                                  | Streaming ingest, S3 user-content, Step Functions, Transcribe, Bedrock Knowledge Bases, S3 Vectors, log/alarm và retention tối thiểu |
| Test             | Test policy và adapter                                                 | Binary không qua API; file sai loại bị từ chối; retrieval chéo nhóm không trả dữ liệu                                                |
| Tài liệu         | `docs/api-contract.md`, `docs/huong-dan-trien-khai-aws.md`             | Ghi upload policy, job states, cost và cleanup                                                                                       |

Tiêu chí bàn giao MVP: phiên họp → consent/cấp quyền → live transcription chạy nền trong suốt phiên → transcript có timestamp/speaker ẩn danh → người dùng sửa → biên bản chỉ ghi diễn biến → ingestion tài liệu/biên bản → Q&A theo meeting có citation; truy vấn meeting/nhóm khác không lấy được nguồn. Upload audio dùng cho phục hồi/kiểm thử; tài liệu là nguồn RAG bổ sung.

Trình tự M5 thực hiện:

1. Chốt loại file, kích thước tối đa và thời gian lưu. API kiểm tra tên file, MIME, kích thước và checksum trước khi cấp đường dẫn upload tạm thời.
2. Frontend xin presigned URL rồi upload trực tiếp lên S3. Không gửi nội dung audio/tài liệu qua API Gateway hoặc Lambda.
3. Sau upload, tạo `AIJob` với trạng thái đang chờ/đang chạy/thành công/thất bại. Frontend đọc trạng thái định kỳ và hiển thị lỗi an toàn, không lộ log nội bộ.
4. Step Functions điều phối công việc dài; Amazon Transcribe tạo transcript tiếng Việt có timestamp, độ tin cậy và nhãn `Speaker 0/1`. Không tự đoán tên người nói.
5. Làm màn hình cho người dùng nghe theo timestamp, sửa câu và tự ánh xạ speaker sang thành viên. Mỗi lần sửa cần version để tránh ghi đè thay đổi mới hơn.
6. Từ transcript đã duyệt, hệ thống tạo bản nháp biên bản chỉ ghi diễn biến theo trình tự, không gợi ý action item/task/bước tiếp theo. Tài liệu và biên bản đã duyệt được ingest vào Bedrock Knowledge Bases/S3 Vectors với metadata filterable tối thiểu gồm `groupId`, `meetingId`, `sourceType`, `sourceId`, `version` và `approved=true`.
7. Endpoint meeting chat kiểm tra membership trước retrieval, luôn áp filter `groupId`/`meetingId`/ACL và chỉ dùng tài liệu cuộc họp cùng biên bản đã duyệt. Nếu không đủ nguồn, trợ lý yêu cầu người dùng cung cấp thêm thông tin/tài liệu liên quan hoặc báo không đủ căn cứ.
8. Test bắt buộc chứng minh câu trả lời chỉ dẫn nguồn từ meeting hiện tại và không bao giờ retrieve dữ liệu meeting/nhóm khác.
9. Ghi metric số job ingestion/query lỗi-thành công, token/chi phí cơ bản và citation thiếu; đặt retention/cleanup xuyên S3, DynamoDB, Knowledge Base và vector để dữ liệu thử nghiệm không tồn tại vô hạn.

## 2.2 Quy tắc làm song song

1. Mỗi người tạo branch riêng từ `main`; một issue chỉ chứa một phần bàn giao nhỏ.
2. PR contract đầu tiên chỉ sửa `packages/shared` và `docs/api-contract.md`, merge sớm trước khi UI/API tách nhánh dài.
3. Sau khi contract merge, mỗi người chủ yếu sửa thư mục feature/application của mình.
4. `services/api/src/index.ts`, `apps/web/src/routes/router.tsx` và `infra/template.yaml` là file dùng chung; mỗi owner chỉ thêm route/resource tối thiểu trong PR riêng để giảm conflict.
5. Khi dependency chưa xong, dùng adapter/repository fake theo đúng contract; không chờ người khác và không hard-code dữ liệu vào page.
6. Một chức năng chỉ hoàn thành khi có UI → API → dữ liệu, validation/quyền, một happy-path test và một test lỗi quan trọng.

## 2.3 Giải thích thuật ngữ dùng trong bảng

| Thuật ngữ              | Nghĩa trong dự án                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Frontend (FE)          | Phần giao diện React người dùng nhìn thấy trong`apps/web`                                          |
| Backend (BE)           | Phần Node.js/TypeScript xử lý yêu cầu trong`services/api`                                          |
| API                    | Đường giao tiếp giữa frontend và backend, ví dụ`POST /groups`                                      |
| Contract/DTO           | Cấu trúc dữ liệu hai phía thống nhất; đặt trong`packages/shared`, không copy lại                   |
| Handler                | File nhận request HTTP và trả response; không chứa toàn bộ nghiệp vụ                               |
| Application service    | Nơi điều phối nghiệp vụ như kiểm tra quyền, validation và gọi repository                           |
| Repository             | Lớp chuyên đọc/ghi dữ liệu DynamoDB để nghiệp vụ không phụ thuộc chi tiết database                 |
| Adapter                | Lớp kết nối dịch vụ ngoài như Google Calendar, Amazon Transcribe hoặc Bedrock                      |
| Mock/adapter giả       | Dữ liệu hoặc dịch vụ thay thế dùng khi phát triển/test, không phải tích hợp production             |
| Idempotent/chống trùng | Gửi lại cùng yêu cầu vẫn chỉ tạo một kết quả, ví dụ không tạo hai Calendar Event                   |
| Presigned URL          | Đường dẫn S3 có thời hạn để browser upload trực tiếp, không chuyển file qua Lambda                 |
| STT                    | Chuyển giọng nói thành văn bản; trong MVP dùng Amazon Transcribe tiếng Việt                        |
| Citation               | Dẫn nguồn chỉ ra câu trả lời AI dựa vào tài liệu/transcript nào                                    |
| IaC                    | Khai báo tài nguyên AWS bằng file SAM/CloudFormation trong`infra`, không tạo tùy tiện bằng Console |

## 3. Kế hoạch 8 tuần

| Tuần | Mục tiêu                          | Công việc chính                                                                                                                                                            | Mốc kiểm tra                                                                                                  |
| ---- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | Khóa baseline                     | Commit scaffold, chốt API/data model/Git workflow, test Google OAuth feasibility sớm, rà SAM skeleton                                                                      | 5 máy đều install và quality gates pass; owner đã gán                                                         |
| 2    | Group foundation                  | Group CRUD nội bộ, membership model, authorization boundary cơ bản                                                                                                         | Tạo/xem group bằng UI → API dev/local                                                                         |
| 3    | Invitation và meeting nội bộ      | Invitation accept/reject/expiry, meeting CRUD chưa Google                                                                                                                  | Mốc MVP 1 chạy đầu-cuối và có test quyền âm                                                                   |
| 4    | Luồng sau họp                     | Minutes, decisions, action items, tasks, dashboard                                                                                                                         | Mốc MVP 2 chạy đầu-cuối                                                                                       |
| 5    | Google integration                | OAuth, Calendar Event,`googleSyncStatus`, retry/idempotency, prototype Meet artifact sync và Meet Add-on side panel unpublished                                            | Demo pending/ready/retry/action-required; add-on lấy meeting context hoặc có fallback; không có Meet link giả |
| 6    | Reminder, notification và AI data | EventBridge reminder; S3 presigned upload; Attachment/Recording/AIJob; consent và retention                                                                                | Hủy meeting không gửi reminder; binary không qua API; upload policy test                                      |
| 7    | AI vertical slice và vận hành     | Live STT tiếng Việt chạy nền, batch chuẩn hóa, transcript editor, bản nháp biên bản diễn biến, Knowledge Base/S3 Vectors ingestion và Bedrock RAG theo meeting; alarm/cost | Demo một meeting có live transcript → biên bản → ingestion tài liệu/biên bản → hỏi đáp có citation            |
| 8    | Đóng băng                         | Test filter`groupId`/`meetingId`/ACL, citation đúng meeting, prompt injection, tool confirmation; fix, demo, cleanup rehearsal                                             | Core MVP + AI MVP gồm RAG theo meeting pass; evidence/cost/cleanup xác nhận                                   |

Hai mốc MVP bắt buộc:

1. Tạo nhóm → mời thành viên → tham gia nhóm → tạo cuộc họp nội bộ.
2. Tạo cuộc họp → biên bản → task → cập nhật `DONE` → dashboard thay đổi.
3. Meeting → consent/cấp quyền → live transcription chạy nền trong suốt phiên → transcript có timestamp/confidence → người dùng sửa/ánh xạ speaker → bản nháp biên bản chỉ ghi diễn biến → ingestion tài liệu/biên bản vào Knowledge Base/S3 Vectors → RAG theo meeting có citation và không rò dữ liệu chéo meeting/nhóm.

Pha mở rộng sau baseline: public/private Marketplace release, trợ lý yêu cầu người dùng cung cấp thông tin cuộc họp/hỏi lại khi thiếu để điền agenda-form và Document PiP. Live transcription chạy nền trong mọi phiên họp, biên bản không có gợi ý và RAG theo meeting với filter `groupId`/`meetingId`/ACL là đầu ra bắt buộc của M5.

## 4. Phụ thuộc giữa các luồng

| Luồng                 | Phụ thuộc                                                                    | Owner chính | Owner phối hợp                                 |
| --------------------- | ---------------------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| Group                 | Cognito identity, shared DTO                                                 | M1          | M5 về DynamoDB/infra                           |
| Membership/invitation | Group, authorization, email/link policy                                      | M1          | M3 về assignee; M5 về email/runtime            |
| Meeting               | Group membership, organizer rule                                             | M2          | M1 về membership; M4 về Google                 |
| Google integration    | Meeting lifecycle, OAuth config, secret storage                              | M4          | M2 về lifecycle; M5 về secret/runtime          |
| Meet Add-on surface   | HTTPS route, manifest/origin, meeting context, shared auth/API, web fallback | M4          | M2 về meeting context; M5 về CloudFront/header |
| Reminder              | Meeting status, scheduler role, notification repository                      | M4          | M2 về lifecycle; M5 về runtime                 |
| Minutes/task          | Completed meeting, active member rule                                        | M3          | M1 về assignee; M2 về meeting                  |
| Dashboard             | Meeting/task APIs và permission                                              | M3          | M1 về group; M2 về meeting                     |
| Monitoring            | API/Reminder/AI signals, SNS subscription                                    | M5          | M1–M4 định nghĩa metric hữu ích                |
| Attachment/recording  | Membership, S3 policy, consent/retention, checksum/scan                      | M5          | M1 về quyền; M2 về meeting                     |
| STT/transcript        | Recording hợp lệ, AIJob, provider benchmark                                  | M5          | M3 về biên bản diễn biến                       |
| Bedrock grounding     | Tài liệu/biên bản đã duyệt, citation schema, meeting/ACL filter              | M5          | M1 về ACL; M3 về biên bản/citation             |
| Tool proposal         | API nghiệp vụ và authorization hoàn chỉnh                                    | M5          | M1–M3 về policy và API nghiệp vụ               |

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

| Nội dung                         | Lựa chọn/Ghi chú                                                                                                                                         | Người chốt   | Hạn chốt                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------- |
| Tên thật tương ứng M1–M5         | Điền sau buổi phân công                                                                                                                                  | Cả nhóm      | Tuần 1                                   |
| GitHub Issues hay GitHub Project | Chọn một nguồn theo dõi duy nhất                                                                                                                         | Cả nhóm      | Tuần 1                                   |
| AWS Region dev                   | Chưa chốt; kiểm tra availability/chi phí                                                                                                                 | M5 + cả nhóm | Trước deploy dev                         |
| Email demo SES                   | Chưa chốt sender/recipient và consent                                                                                                                    | M5           | Trước tuần 6                             |
| Redirect URI local               | Dự kiến`http://localhost:5173/...`; M4/M5 xác nhận flow                                                                                                  | M4 + M5      | Tuần 1                                   |
| Redirect URI deployed            | Phụ thuộc CloudFront/custom domain output                                                                                                                | M4 + M5      | Trước tuần 5                             |
| Quyền ghi biên bản               | SRS cho phép cấu hình; cần rule MVP cụ thể                                                                                                               | M2 + M3      | Tuần 2                                   |
| Quyền tạo/giao task              | Chốt admin-only hay quyền được ủy quyền                                                                                                                  | M2 + M3      | Tuần 2                                   |
| Khi Google integration lỗi       | Chốt retry limit, trạng thái và UX action                                                                                                                | M3 + M4      | Trước tuần 5                             |
| Ngày khóa scope MVP              | Không thêm feature ngoài SRS sau mốc                                                                                                                     | Cả nhóm      | Cuối tuần 1                              |
| DynamoDB access pattern/index    | Placeholder hiện chưa phải database design hoàn chỉnh                                                                                                    | M3 + M5      | Trước tuần 2                             |
| CORS/domain/retention/PITR       | Chốt theo môi trường và budget                                                                                                                           | M5 + cả nhóm | Trước deploy dev                         |
| Google artifact strategy         | Đã chốt: Calendar tạo lịch; Meet REST sync khi có; upload/capture fallback; polling AWS cho MVP                                                          | M4 + M5      | Đã chốt, kiểm tra lại khi implement      |
| Meet Add-on distribution         | Đã chốt: CampusMeet web vẫn là chính; MVP thử deployment chưa công bố; private/public Marketplace là pha phát hành riêng, không đổi audience sau publish | M1 + M4 + M5 | Spike tuần 5; quyết định publish sau MVP |
| Recording consent/capture        | Chốt nội dung consent, nguồn micro/tab/system audio, chỉ báo, stop và retention                                                                          | M1 + M2 + M3 | Trước tuần 6                             |
| Upload allowlist/size/scan       | Chốt file MVP; PDF/TXT/DOCX/audio trước, định dạng nâng cao sau                                                                                          | M3 + M5      | Trước tuần 6                             |
| STT provider tiếng Việt          | Amazon Transcribe mặc định; benchmark Deepgram trên cùng tập audio trước khi khóa adapter                                                                | M4 + M5      | Đầu tuần 7                               |
| AI model/Region                  | Chọn model Bedrock hỗ trợ Region và tool/citation; model ID là env config                                                                                | M4 + M5      | Trước tuần 7                             |
| Grounding/citation theo meeting  | Chốt citation schema, hai source type tài liệu/biên bản, metadata`groupId`/`meetingId`/ACL và filter trước retrieval                                     | M5 + M3      | Trước tuần 7                             |
| AI mutation policy               | Chỉ`ToolProposal`; schema + auth + preview + confirm + idempotency + audit                                                                               | M1 + M3 + M4 | Trước pha AI-2                           |
| AI retention/cost                | Chốt audio/transcript/conversation/vector TTL và quota token/phút                                                                                        | M3 + M5      | Trước deploy AI                          |
