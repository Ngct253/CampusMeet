# Kế hoạch M5 — Upload, Voice Transcript và AI trong nhóm

Tài liệu này chốt phạm vi M5. M5 xây pipeline AI từ tài liệu và voice record, hỗ trợ chatbot kiểu source-grounded, biên bản/task proposal, RAG tối đa trong một nhóm và phân tích tiến độ nhóm. M5 không nhận diện danh tính speaker và không sở hữu CRUD Group/Meeting/Minutes/Task.

## 1. Kết quả M5 phải bàn giao

Luồng đầu-cuối:

```text
upload tài liệu trước/trong/sau meeting
→ tài liệu READY
→ consent + cấp quyền capture
→ live STT giữ ngôn ngữ đang nói
→ transcript timestamp/confidence/languageCode/Speaker N
→ chatbot hỏi đáp + tóm tắt cho người vào trễ
→ người có quyền hiệu chỉnh/duyệt transcript
→ AI tạo biên bản + action item + TaskProposal có citation
→ người dùng duyệt/confirm
→ M3 Task API tạo task idempotent
→ RAG current/selected/whole-group
→ AI diễn giải GroupProgressSnapshot
```

Nguyên tắc bắt buộc:

- Voice record/live transcript là nguồn duy nhất để xác định nội dung đã được phát biểu.
- Live transcription chạy nền trong mọi phiên họp sau user gesture/consent/capture hợp lệ.
- STT giữ ngôn ngữ đang nói; không tự dịch. Tiếng Việt là ngôn ngữ benchmark ưu tiên.
- Speaker chỉ là `Speaker 1`, `Speaker 2`,… trong session; không ánh xạ hoặc đoán danh tính.
- Tài liệu có thể upload trước, trong hoặc sau meeting; chatbot chỉ dùng file `READY`.
- Chatbot dùng tài liệu, transcript và biên bản có trạng thái phù hợp, luôn trả citation hoặc `insufficientContext`.
- RAG có ba scope nhưng mỗi query chỉ thuộc một `groupId`; không cross-group.
- AI tạo task proposal từ action item đã được nêu; không tự bịa assignee/deadline.
- Task chỉ được tạo sau preview, xác nhận, authorization và idempotency qua Task API của M3.
- Phân tích tiến độ chỉ ở cấp nhóm từ snapshot do backend tính; không chấm điểm/xếp hạng/suy diễn thái độ cá nhân.

## 2. Phạm vi đã khóa

### Thuộc M5

- Presigned upload tài liệu/audio, trạng thái upload/scan/ingestion.
- `AIJob` cho parse, STT, ingestion, generation.
- Live transcription session, streaming ingest, reconnect và batch phục hồi.
- STT đa ngôn ngữ; tiếng Việt phải có tập benchmark chính.
- Transcript editor có version, timestamp, confidence, language và `Speaker N`.
- Current-meeting chatbot trên tài liệu + live/approved transcript + minutes.
- Tóm tắt phần đã diễn ra cho người vào trễ.
- Biên bản, quyết định/action item và task proposal có citation.
- Confirm task proposal qua M3 Task API.
- RAG `CURRENT_MEETING`, `SELECTED_MEETINGS`, `WHOLE_GROUP`.
- Group progress analysis từ `GroupProgressSnapshot`.
- Authorization, citation, idempotency, monitoring, retention, cost và cleanup.

### Không thuộc M5

- RAG/query kết hợp nhiều group.
- Nhận diện danh tính speaker, voice biometric hoặc speaker-to-user mapping.
- Reranking, implicit filter, hybrid search nâng cao hoặc tự tối ưu chunking.
- Chấm điểm/xếp hạng thành viên hoặc suy diễn thái độ.
- AI phân tích video dài.
- AI tự ghi minutes/task hoặc đổi task status khi chưa có xác nhận.
- Tool use ngoài allowlist task của M5.
- Public Marketplace, Document PiP và Meet Media API.

## 3. Ranh giới ownership với M1–M4

| Miền | Owner | M5 được làm | M5 không được làm |
| --- | --- | --- | --- |
| Group/membership | M1 | Gọi authorization helper; lưu `groupId`/ACL vào metadata AI. | Viết lại Group CRUD, membership hoặc role policy. |
| Meeting | M2 | Dùng `meetingId`, lifecycle và meeting context. | Sửa Meeting CRUD/lifecycle hoặc tự tin `groupId` client gửi. |
| Minutes | M3 | Sinh `MinutesDraft` có citation và gửi cho luồng review/save. | Ghi trực tiếp bảng Minutes hoặc thay quyền ghi biên bản. |
| Task | M3 | Sinh `TaskProposal`; confirm gọi Task application service/API. | Ghi trực tiếp bảng Tasks, tự gán assignee/deadline hoặc đổi status. |
| Dashboard/progress | M3 | Đọc `GroupProgressSnapshot` và diễn giải. | Tự tính số liệu bằng LLM hoặc tạo aggregate khác M3. |
| Google integration | M4 | Dùng artifact reference nếu khả dụng; capture/upload là fallback. | Thay OAuth/Calendar/Meet adapter hoặc phụ thuộc artifact bắt buộc. |
| AWS chung | M5 review | Thêm tài nguyên AI tối thiểu bằng SAM, metric/alarm/cleanup. | Viết thay toàn bộ hạ tầng của M1–M4 hoặc tạo resource trùng. |

Nếu dependency chưa hoàn thành, M5 dùng fake adapter đúng contract trong test/dev; production handler không hard-code user/group/meeting/task giả.

## 4. Shared contract tối thiểu

- `Attachment`, `CreateUploadUrlRequest`, `CompleteUploadRequest`.
- `AIJob`, `AIJobStatus`.
- `LiveTranscriptionSession`, `StartLiveTranscriptionRequest`.
- `Transcript`, `TranscriptSegment`.
- `MeetingChatRequest`, `GroupKnowledgeQuery`.
- `GroundedAnswer`, `Citation`, `KnowledgeScope`.
- `GenerateMinutesAndTaskProposalsRequest/Response`.
- `TaskProposal`, `ConfirmTaskProposalRequest/Response`.
- `GroupProgressSnapshot`, `GroupProgressAnalysisRequest/Response`.

### Transcript segment

```text
TranscriptSegment {
  segmentId
  sequence
  startMs
  endMs
  text
  confidence
  languageCode
  speakerLabel  // Speaker 1, Speaker 2, ...
  version
}
```

Không có `speakerUserId` hoặc trường nhận diện giọng nói.

### Knowledge scope

```text
CURRENT_MEETING
SELECTED_MEETINGS
WHOLE_GROUP
```

`SELECTED_MEETINGS` bắt buộc có `meetingIds[]`; backend xác minh toàn bộ meeting thuộc path `groupId`. `WHOLE_GROUP` không nhận meeting ngoài group.

### Task proposal

```text
TaskProposal {
  proposalId
  groupId
  meetingId
  title
  description?
  assigneeId?
  priority?
  dueAtUtc?
  missingFields[]
  citations[]
  status
}
```

Trạng thái:

```text
PENDING | CONFIRMED | EXECUTED | REJECTED | EXPIRED | FAILED
```

## 5. API mục tiêu

| Method | Route | Mục đích |
| --- | --- | --- |
| POST | `/meetings/{meetingId}/attachments/upload-url` | Presigned URL sau quyền/metadata check. |
| POST | `/meetings/{meetingId}/attachments/{attachmentId}/complete` | Verify checksum/scan rồi tạo parse job. |
| GET | `/meetings/{meetingId}/attachments` | File và trạng thái ingestion. |
| POST | `/meetings/{meetingId}/live-transcription` | Tạo session sau consent/capture. |
| POST | `/meetings/{meetingId}/live-transcription/{sessionId}/stop` | Dừng stream, chốt sequence. |
| POST | `/meetings/{meetingId}/transcriptions` | Batch phục hồi/chuẩn hóa. |
| GET | `/meetings/{meetingId}/transcripts` | Đọc transcript/version. |
| PATCH | `/transcripts/{transcriptId}/segments/{segmentId}` | Sửa text/language/`Speaker N`, lưu audit/version. |
| POST | `/meetings/{meetingId}/ai/chat` | Current-meeting Q&A và live summary. |
| POST | `/groups/{groupId}/ai/search` | Selected-meetings/whole-group Q&A. |
| POST | `/meetings/{meetingId}/ai/minutes-draft` | Minutes + action item + task proposal draft. |
| POST | `/meetings/{meetingId}/ai/task-proposals` | Thành viên meeting tạo/làm mới proposal có citation; chưa tạo Task. |
| POST | `/ai/task-proposals/{proposalId}/confirm` | Group Admin xác nhận; kiểm tra lại và gọi M3 Task API một lần theo FR-16. |
| POST | `/groups/{groupId}/ai/progress-analysis` | Group Admin yêu cầu diễn giải progress snapshot cấp nhóm. |
| GET | `/ai/jobs/{aiJobId}` | Theo dõi job/status/lỗi an toàn. |

Mọi route phải xác thực JWT, membership và resource ownership. Group query không tin `meetingIds` cho đến khi đã đối chiếu database.

`TaskProposal` là proposal chuyên biệt của engine xác nhận chung, không tạo một cơ chế mutation thứ hai song song với `ToolProposal`; cả hai phải tái sử dụng cùng authorization/idempotency/audit boundary.

## 6. Upload và nguồn chatbot

Tài liệu được upload trước giờ bắt đầu, trong hoặc sau meeting, nhưng bản ghi meeting phải tồn tại trước khi cấp presigned URL. Trạng thái:

```text
UPLOADING | PROCESSING | READY | FAILED | QUARANTINED
```

Chỉ `READY` được retrieval.

Source type:

```text
MEETING_DOCUMENT
LIVE_TRANSCRIPT
APPROVED_TRANSCRIPT
APPROVED_MINUTES
```

Metadata bắt buộc:

```text
groupId
meetingId
sourceType
sourceStatus
sourceId
version
ACL
```

Current meeting dùng `LIVE_TRANSCRIPT`; AI Worker đọc segment final trực tiếp từ transcript repository, không chờ hoặc liên tục kích hoạt Knowledge Base ingestion. Citation phải ghi rõ chưa duyệt. Selected/whole-group chỉ dùng tài liệu `READY`, approved transcript và approved minutes; không đưa live transcript của meeting khác vào query nhóm trong MVP.

## 7. Live transcription

1. UI hiển thị consent, nguồn capture và retention.
2. Người dùng thực hiện browser gesture/cấp quyền.
3. Backend tạo session idempotent `STARTING`.
4. Khi streaming sẵn sàng, session thành `ACTIVE`.
5. Segment final được lưu theo sequence; reconnect không tạo trùng.
6. UI luôn hiển thị trạng thái nhưng không cần nhận diện tên người.

Ngôn ngữ:

- Request có `languageMode=EXPLICIT|AUTO`.
- `EXPLICIT` nhận `primaryLanguageCode`, mặc định cấu hình sản phẩm có thể là `vi-VN`.
- `AUTO` chỉ bật khi provider/region đã được benchmark.
- Output giữ ngôn ngữ nói; translation là feature khác, không thuộc M5.

Speaker:

- Label bắt đầu từ `Speaker 1`.
- Cố giữ ổn định trong một session.
- Người có quyền được sửa label khi diarization sai.
- Không ánh xạ speaker sang member và chatbot không đoán danh tính.

## 8. Chatbot và RAG

### Current meeting

- Trả lời từ tài liệu `READY`, live/approved transcript và minutes.
- Người vào trễ có thể yêu cầu “tóm tắt đến hiện tại”.
- Summary chỉ dùng segment đã có, nêu khoảng stream thiếu và trạng thái chưa duyệt.

### Selected meetings

- Người dùng chọn một số meeting trong cùng group.
- Backend kiểm tra từng meeting thuộc group và người dùng được đọc.
- Citation chỉ rõ meeting + source + page/segment/timestamp.

### Whole group

- Tìm trong tất cả meeting được phép của path group.
- Không cross-group.
- Nếu nguồn mâu thuẫn, trình bày theo meeting/thời gian; không tự tuyên bố nguồn cũ bị thay thế.

MVP dùng retrieval cơ bản có citation; không thêm reranking hoặc implicit filter.

## 9. Biên bản, action item và task

AI được phép tạo:

- Diễn biến/chủ đề đã thảo luận.
- Quyết định đã được nêu.
- Action item đã được nêu.
- Task proposal có citation.

Quy tắc:

- Không cần biết danh tính speaker.
- Chỉ lấy tên assignee khi nội dung transcript gọi tên rõ ràng.
- Không tự đặt deadline hoặc priority.
- Trường bắt buộc của `CreateTaskRequest` còn thiếu (`assigneeId`, `priority`) nằm trong `missingFields[]`; chatbot hỏi người dùng trước confirm. `dueAtUtc` là tùy chọn.
- Proposal không gây mutation.
- Confirm chỉ dành cho Group Admin theo FR-16; kiểm tra lại JWT, group membership, assignee thuộc group, priority/schema và idempotency rồi gọi M3 Task API.
- Task lưu liên kết `meetingId` và citation nguồn.

## 10. Phân tích tiến độ nhóm

M3/backend cung cấp:

```text
GroupProgressSnapshot {
  groupId
  totalTasks
  todoTasks
  doingTasks
  doneTasks
  overdueTasks
  upcomingDeadlines[]
  unresolvedActionItems
  generatedAt
}
```

Chỉ Group Admin được gọi theo quyền dashboard nhóm. AI chỉ diễn giải snapshot và có thể kết hợp citation meeting/task trong cùng group. Không:

- So sánh nhiều group.
- Chấm điểm/xếp hạng thành viên.
- Suy diễn thái độ/hiệu suất cá nhân từ transcript.
- Dùng số lần nói làm thước đo đóng góp.
- Tự đổi task.

## 11. Bảo mật, vận hành và chi phí

- S3 private, presigned URL ngắn hạn, object key do server sinh.
- Allowlist MIME/size/checksum/scan trước ingestion.
- File/transcript là untrusted data; không được đổi system instruction hoặc tự kích hoạt tool.
- Filter group/meeting-set/ACL/source status trước retrieval.
- Không log audio, transcript, prompt, answer, token hoặc presigned URL đầy đủ.
- Retry có giới hạn; complete/transcription/generation/confirm đều idempotent.
- CloudWatch theo dõi stream, jobs, token, phút audio, retrieval empty, citation missing, task confirm failure.
- Retention/xóa bao phủ S3, DynamoDB, transcript, conversation, Knowledge Base và vector.

## 12. Chia PR

| PR | Phạm vi | Điều kiện merge |
| --- | --- | --- |
| M5-01 | Contract, citation, scope, upload policy | M1/M2/M3 review; typecheck pass. |
| M5-02 | Presigned upload + attachment lifecycle | Binary không qua API; file sai bị từ chối. |
| M5-03 | `AIJob` + workflow skeleton | Success/failure/cancel/idempotency pass. |
| M5-04 | STT đa ngôn ngữ + `Speaker N` | Test tiếng Việt + một ngôn ngữ khác; không có identity mapping. |
| M5-05 | Live session + transcript editor | Consent/reconnect/version/audit pass. |
| M5-06 | Current chat + live summary | Citation live/READY source; stream gap hiển thị. |
| M5-07 | Minutes + task proposal + M3 confirm adapter | Missing field hỏi lại; confirm tạo đúng một task. |
| M5-08 | Selected/whole-group RAG | Citation nhiều meeting cùng group; cross-group bị loại trước model. |
| M5-09 | Group progress analysis | Chỉ dùng M3 snapshot; không đánh giá cá nhân/mutation. |
| M5-10 | Monitoring, retention, cleanup, cost/demo | Alarm/failure/cleanup có bằng chứng. |

## 13. Kiểm thử nghiệm thu

- Upload trước/trong meeting chỉ thành nguồn khi `READY`.
- Không consent thì không stream/audio object.
- STT giữ ngôn ngữ, có `languageCode` và `Speaker N`; không có tên người.
- Reconnect/retry không tạo segment/job trùng.
- Người vào trễ nhận summary có citation và cảnh báo live source.
- Minutes/action item/task proposal chỉ lấy nội dung có nguồn.
- Assignee/deadline thiếu không được bịa.
- Confirm hợp lệ gọi M3 Task API một lần; không quyền nhận 403.
- Current/selected/whole-group query trả citation đúng.
- Meeting group khác bị loại trước model.
- Progress analysis chỉ dùng snapshot cùng group và không đánh giá cá nhân.
- Log/retention/cleanup đạt chính sách.

Kịch bản demo:

1. Upload tài liệu trước meeting và xác nhận `READY`.
2. Bắt đầu meeting, consent/capture, nói tiếng Việt và một đoạn ngôn ngữ khác.
3. Kiểm tra transcript `Speaker N`, language/timestamp/confidence.
4. Upload thêm tài liệu trong meeting.
5. Thành viên vào trễ yêu cầu tóm tắt đến hiện tại.
6. Kết thúc, sửa/duyệt transcript; tạo minutes và task proposal.
7. Bổ sung field thiếu, confirm và kiểm tra chỉ một task được tạo.
8. Hỏi current, selected meetings và whole group; mở citation.
9. Thử meeting/group khác và xác nhận không có nguồn rò.
10. Yêu cầu progress analysis; kết quả chỉ ở cấp nhóm.

## 14. Điểm cần chốt trước M5-01

- Consent text, capture source, retention và ai được start/stop.
- Upload allowlist/size/checksum/scan.
- STT provider/region, `AUTO` availability và benchmark tiếng Việt + ngôn ngữ phụ.
- Citation schema cho document/transcript/minutes/task.
- M1 authorization helper và M2 meeting-to-group lookup.
- M3 MinutesDraft, Task API và GroupProgressSnapshot contract.
- Bedrock model/region, quota token/phút audio và budget alarm.

Public Marketplace, Document PiP, cross-group RAG, speaker identity, RAG nâng cao và video analysis không phải blocker của M5.
