# Kế hoạch hoàn thành M5 — Live Transcript, Upload và RAG nhiều cuộc họp

Tài liệu này là kế hoạch triển khai chính thức cho phạm vi M5. Phạm vi bao gồm live transcription tiếng Việt chạy nền trong phiên họp, upload an toàn, xử lý AI bất đồng bộ, hỏi đáp/sinh bản nháp có citation và RAG trên nhiều cuộc họp trong cùng nhóm.

> **Quyết định đã chốt:** RAG nhiều cuộc họp không bị loại khỏi M5. Nhóm triển khai pipeline một meeting trước để kiểm chứng ingestion/citation, sau đó mở truy vấn nhiều meeting bằng cùng Knowledge Base và filter `groupId`/ACL. Đây là thứ tự triển khai, không phải giảm phạm vi.

## 0. Trạng thái hiện tại và chiến lược thực hiện

Tại thời điểm lập kế hoạch:

- `packages/shared` mới có contract cơ bản cho group/meeting/minutes/task; chưa có Attachment, Recording, Consent, live session, Transcript, AIJob, KnowledgeSource, GroundedAnswer hoặc Citation.
- API meeting, membership, minutes và repository DynamoDB vẫn là skeleton/TODO; M5 chưa có handler, application service, repository hoặc provider thật.
- Frontend meeting vẫn dùng mock; chưa có upload, live status, transcript editor, AI chat hoặc citation UI.
- `infra/template.yaml` chưa có user-content bucket, AI tables, Transcribe permission, Step Functions, AI Worker, Bedrock Knowledge Base/S3 Vectors hoặc alarm M5.
- Chưa có test M5. Vì vậy kế hoạch xem M5 là một vertical slice mới, không phải phần hoàn thiện của code đã có.

Chiến lược:

1. Làm spike streaming thật trước khi mở rộng contract để loại rủi ro lớn nhất.
2. Khóa contract và ranh giới dependency với M1–M4.
3. Hoàn thành nguồn dữ liệu: consent → live stream → final segment → transcript editor.
4. Hoàn thành ingestion/RAG một meeting, sau đó mở nhiều meeting bằng metadata filter.
5. Thêm minutes/action-item draft, monitoring, retention, cleanup và bằng chứng demo.

Ước lượng cho một người làm M5: **20 ngày làm việc**, chưa tính thời gian chờ M1/M2 cung cấp membership/meeting thật hoặc chờ AWS quota/model access. Nếu chỉ có 10 ngày, phải tăng người hỗ trợ hoặc giảm chất lượng/độ an toàn; không được bỏ live transcription hay RAG nhiều cuộc họp vì đây là đầu ra đã chốt.

## 1. Kết quả M5 phải bàn giao

Luồng demo hoàn chỉnh:

```text
Phiên họp → consent/cấp quyền capture → live transcription chạy nền
hoặc upload tài liệu/audio để phục hồi, kiểm thử hay bổ sung nguồn
→ Streaming STT hoặc S3 user-content + AIJob bất đồng bộ
→ Amazon Transcribe/parse
→ Transcript/chunk đã duyệt
→ Bedrock Knowledge Base + S3 Vectors
→ hỏi trên nhiều meeting trong cùng group
→ câu trả lời hoặc minutes/action-item draft có citation
```

Điều kiện hoàn thành:

1. Binary không đi qua API Gateway/Lambda payload.
2. `AIJob` dùng đúng trạng thái `QUEUED/PROCESSING/COMPLETED/FAILED/CANCELLED`.
3. Live transcription chạy nền trong mỗi phiên họp sau consent/cấp quyền; transcript có timestamp, confidence và speaker label ẩn danh; người dùng được sửa và ánh xạ speaker bằng optimistic version.
4. Nguồn chỉ được ingest khi đã xác minh và mang metadata quyền.
5. Một truy vấn group RAG có thể dẫn nguồn từ ít nhất hai meeting cùng nhóm.
6. Retrieval luôn filter `groupId` trước khi đưa chunk cho model; filter `meetingId` là tùy chọn.
7. Citation mở đúng meeting/file/transcript segment; thiếu nguồn phải trả `insufficientContext=true`.
8. Có test chứng minh không retrieve dữ liệu nhóm khác.
9. Có log/metric/alarms, chi phí ước tính, retention và cleanup xuyên các kho dữ liệu.

## 2. Phạm vi và giới hạn

### Bắt buộc

- Presigned upload và complete-upload verification.
- Attachment, Recording, Consent, Transcript, TranscriptSegment và AIJob.
- Live STT tiếng Việt chạy nền qua `SpeechToTextProvider`; Amazon Transcribe `vi-VN` là provider đầu tiên.
- Lưu liên tục segment đã ổn định; hỗ trợ batch chuẩn hóa/phục hồi sau họp.
- Transcript editor, timestamp playback và speaker mapping.
- Chuẩn hóa nguồn và ingestion vào Bedrock Knowledge Bases + S3 Vectors.
- RAG trên toàn bộ hoặc một tập meeting trong cùng group.
- Q&A, minutes draft và action-item draft có citation.
- Authorization, idempotency, retry, monitoring, retention và cleanup.

### Không thuộc M5 baseline

- Reranking/implicit metadata filter tự suy luận.
- Nhiều data source ngoài S3.
- Tool proposal nhiều miền và mutation tự động.
- Public Marketplace release.
- Phân tích/chấm điểm cá nhân từ participant hoặc transcript.

## 3. Phụ thuộc với thành viên khác

| Phụ thuộc        | Owner cung cấp     | M5 cần                                                                                                   |
| ---------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| Group/membership | M1                 | Hàm kiểm tra active membership/role theo `groupId`; M5 không tin `groupId` client gửi nếu chưa kiểm tra. |
| Meeting          | M2                 | `meetingId`, `groupId`, trạng thái meeting và quyền xem meeting.                                         |
| Minutes/task     | M3                 | Contract nhận minutes/action-item draft và luồng duyệt trước khi tạo task.                               |
| Google artifact  | M4                 | Recording/transcript reference khi Google Meet artifact tồn tại; M5 vẫn hỗ trợ upload fallback.          |
| AWS dùng chung   | Cả nhóm, M5 review | Region, CloudFront origin, Cognito claims, naming/tagging và budget.                                     |

M5 có thể dùng fake repository/provider đúng contract khi dependency chưa hoàn thành; không hard-code membership hoặc meeting giả vào production handler.

Gate dependency:

- Trước PR M5-01: M1/M2 xác nhận shape `Membership`, `Meeting` và cách lấy `groupId` tin cậy từ `meetingId`.
- Trước PR M5-03: middleware membership và meeting repository thật phải dùng được; fake chỉ tồn tại trong test/local adapter.
- Trước PR M5-09: M3 chốt DTO nhận minutes/action-item draft và luồng duyệt.
- M4/Google artifact không nằm trên critical path; live capture của M5 vẫn phải chạy khi Google không cung cấp transcript.

## 4. Contract cần khóa trước khi triển khai

### 4.1 Trạng thái

```text
AIJobStatus:
QUEUED | PROCESSING | COMPLETED | FAILED | CANCELLED

AttachmentStatus:
PENDING_UPLOAD | VALIDATING | READY | REJECTED | DELETED

TranscriptStatus:
LIVE | FINALIZING | READY | FAILED

LiveTranscriptionSessionStatus:
STARTING | ACTIVE | RECONNECTING | STOPPED | FAILED

IngestionStatus:
NOT_REQUESTED | QUEUED | SYNCING | INDEXED | FAILED | STALE
```

### 4.2 Entity tối thiểu

- `Attachment`: `attachmentId`, `groupId`, `meetingId`, object key, filename hiển thị, MIME, size, checksum, status, owner, retention.
- `Recording`: nguồn recording/capture, consent reference, duration và S3 reference.
- `Consent`: actor, thời điểm, nguồn capture, nội dung đồng ý và thời hạn lưu.
- `LiveTranscriptionSession`: meeting, trạng thái `STARTING/ACTIVE/RECONNECTING/STOPPED/FAILED`, nguồn capture, sequence cuối đã xác nhận và thời điểm heartbeat.
- `AIJob`: loại job, resource nguồn, trạng thái, attempt, provider, requestId, cost metadata và lỗi an toàn.
- `Transcript`: provider, language, trạng thái live/final, version và source recording.
- `TranscriptSegment`: sequence, start/end, text, confidence, speakerLabel, `isFinal`, `speakerUserId?`, version và audit.
- `KnowledgeSource`: source type/id/version, `groupId`, `meetingId`, ingestion status và normalized S3 key.
- `Citation`: meeting/source/segment, timestamp hoặc page/chunk, tiêu đề hiển thị và URI nội bộ.
- `GroundedAnswer`: answer, citations, scope, `insufficientContext` và conversation ID.

### 4.3 Endpoint mục tiêu

| Method | Endpoint                                                                | Kết quả                                                                        |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/meetings/{meetingId}/attachments`                                     | Tạo attachment và presigned upload URL.                                        |
| POST   | `/meetings/{meetingId}/attachments/{attachmentId}/complete`             | Xác minh object; trả `202` cùng `aiJobId` khi tạo job.                         |
| GET    | `/ai/jobs/{aiJobId}`                                                    | Đọc trạng thái/progress/lỗi an toàn.                                           |
| POST   | `/meetings/{meetingId}/transcripts`                                     | Tạo transcription job idempotent.                                              |
| GET    | `/meetings/{meetingId}/transcripts`                                     | Lấy transcript và segment theo trang.                                          |
| PATCH  | `/meetings/{meetingId}/transcripts/{transcriptId}/segments/{segmentId}` | Sửa text/speaker với `expectedVersion`; version cũ trả `409`.                  |
| POST   | `/meetings/{meetingId}/live-transcription`                              | Sau consent, tạo phiên streaming idempotent và trả thông tin kết nối ngắn hạn. |
| GET    | `/meetings/{meetingId}/live-transcription/{sessionId}`                  | Đọc trạng thái, heartbeat và sequence cuối của phiên.                          |
| POST   | `/meetings/{meetingId}/live-transcription/{sessionId}/segments`         | Ghi một batch final segment theo sequence; gửi lại không tạo trùng.            |
| POST   | `/meetings/{meetingId}/live-transcription/{sessionId}/stop`             | Kết thúc stream, chốt sequence cuối và kích hoạt bước chuẩn hóa sau họp.       |
| POST   | `/meetings/{meetingId}/ai/chat`                                         | Hỏi trong một meeting, trả `202`/job hoặc response theo contract đã chốt.      |
| POST   | `/groups/{groupId}/ai/search`                                           | RAG trên nhiều meeting cùng nhóm; nhận `meetingIds?`.                          |
| POST   | `/meetings/{meetingId}/ai/minutes-draft`                                | Sinh minutes/action-item draft có citation.                                    |

### 4.4 Quyết định kiến trúc streaming MVP

```text
Browser getDisplayMedia/tab audio
├── Web Audio → PCM 16 kHz → presigned Amazon Transcribe WebSocket
│                              └── partial/final events về Browser
├── final segment batch → CampusMeet API → DynamoDB transcript
└── recording chunk → presigned S3 upload → batch đối soát sau meeting
```

- API chỉ cấp URL WebSocket Transcribe đã ký sau khi kiểm tra JWT, meeting, membership, consent, quota và session idempotency; thời hạn ký ngắn và reconnect phải xin URL mới.
- Audio không đi qua API Gateway/Lambda. API chỉ nhận final transcript segment có giới hạn kích thước, sequence và `ResultId`.
- Partial segment chỉ hiển thị tức thời. Chỉ `IsPartial=false` mới được lưu và dùng cho AI hạ nguồn.
- Raw recording của cùng capture session được đưa vào S3 để batch chuẩn hóa/đối soát. Không dùng agenda hoặc participant metadata thay cho nội dung phát biểu.
- Spike M5-00 phải chứng minh tab audio, PCM, `vi-VN`, final segment, reconnect và stop hoạt động trên trình duyệt demo trước khi nhóm đầu tư toàn bộ hạ tầng.

## 5. Thiết kế upload an toàn

1. API xác thực user và membership/meeting trước khi tạo attachment.
2. Backend sinh `attachmentId` và object key; filename người dùng không được dùng làm key.
3. API kiểm tra allowlist MIME/đuôi, size khai báo và checksum trước khi ký.
4. Presigned URL có hạn ngắn, ký checksum và chỉ cho phép đúng object key.
5. Browser upload trực tiếp lên S3, sau đó gọi complete.
6. Complete handler gọi `HeadObject` để kiểm tra lại size, checksum và metadata; không tin dữ liệu complete từ client.
7. Complete phải idempotent; gọi lại không tạo thêm AIJob.
8. Object chưa xác minh giữ trạng thái `VALIDATING` và không được đưa vào STT/ingestion.
9. S3 bật Block Public Access, encryption, lifecycle và CORS chỉ cho origin đã chốt; không dùng wildcard production.

MVP ưu tiên audio và TXT. PDF/DOCX chỉ mở khi nhóm có parser, giới hạn tài nguyên và trạng thái quarantine/validation phù hợp.

## 6. Xử lý AI bất đồng bộ

### 6.1 Ranh giới quyền

- API Lambda: presign, xác minh metadata, tạo/đọc AIJob và start execution.
- Step Functions role: điều phối state machine và chỉ gọi đúng service/worker cần thiết.
- AI Worker role: đọc prefix S3 được cấp, ghi normalized output, cập nhật bảng AI và gọi provider được cấu hình.
- Knowledge Base service role: đọc data-source prefix và ghi đúng S3 vector index.

Không cấp `transcribe:*`, `bedrock:*` hoặc `s3:*` rộng cho API Lambda.

### 6.2 State machine tối thiểu

```text
ValidateJob
→ MarkProcessing
→ Choice(sourceType)
   ├── audio → StartTranscribe → Wait/Poll → NormalizeTranscript
   └── text/document → ParseAndNormalize
→ BuildKnowledgeSource
→ Start/TrackIngestion
→ MarkCompleted

Catch mọi nhánh
→ lưu lỗi an toàn
→ MarkFailed
→ metric/alarm
```

Yêu cầu:

- Execution/job name idempotent theo `aiJobId`.
- Retry chỉ cho lỗi tạm thời, có backoff và giới hạn.
- Timeout/cancel chuyển trạng thái rõ ràng.
- Không ghi audio, transcript, prompt, presigned URL hoặc model response nhạy cảm vào log.

### 6.3 Luồng live transcription bắt buộc

```text
Meeting bắt đầu
→ kiểm tra membership + consent + quyền capture
→ tạo LiveTranscriptionSession idempotent
→ Browser gửi audio chunk qua kết nối streaming ngắn hạn
→ SpeechToTextProvider trả partial/final segment
→ chỉ lưu và phát sự kiện từ final segment theo sequence
→ heartbeat/reconnect tiếp tục từ sequence cuối đã xác nhận
→ dừng meeting hoặc stop session
→ chốt transcript và chạy batch chuẩn hóa nếu cần
```

Quy tắc:

- Phiên live chạy nền trong mọi meeting sau khi được cấp consent/quyền; người dùng luôn nhìn thấy trạng thái `STARTING/ACTIVE/RECONNECTING/FAILED`.
- Live transcript là nguồn chuẩn duy nhất để xác định nội dung phát biểu và cung cấp dữ liệu cho tóm tắt, quyết định, action item, hỏi đáp và RAG.
- Agenda, attendee/participant metadata hoặc tài liệu đính kèm không được dùng để suy đoán người tham gia đã nói gì. Tài liệu chỉ là nguồn ngữ cảnh bổ sung và có citation riêng.
- Nếu session chưa `ACTIVE`, bị mất quyền hoặc chuyển `FAILED`, backend trả trạng thái chưa đủ dữ liệu cho mọi chức năng AI phụ thuộc nội dung; không âm thầm chuyển sang nguồn suy đoán khác.
- Partial segment có thể hiển thị tạm thời nhưng không được ingest, tạo citation hoặc cấp cho chức năng AI hạ nguồn cho tới khi thành final.
- Reconnect và gửi lại chunk/segment phải idempotent theo `sessionId + sequence`.

## 7. RAG nhiều cuộc họp

### 7.1 Chuẩn hóa và ingestion

Mỗi source đã duyệt tạo:

```text
kb/{groupId}/{meetingId}/{sourceId}/v{version}/content.txt
kb/{groupId}/{meetingId}/{sourceId}/v{version}/content.txt.metadata.json
```

Metadata filterable tối thiểu:

```json
{
  "groupId": "group-id",
  "meetingId": "meeting-id",
  "sourceType": "TRANSCRIPT",
  "sourceId": "source-id",
  "version": 1,
  "approved": true
}
```

`groupId`, `meetingId` và `approved` phải là metadata filterable. Nội dung chunk lớn không đưa vào metadata filterable. M5 lưu mapping source/version/ingestion job trong DynamoDB để biết vector nào đang current hoặc stale.

### 7.2 Retrieval

1. Backend xác thực JWT.
2. Backend kiểm tra active membership với group từ path.
3. Backend xây filter bắt buộc `groupId == authorizedGroupId` và `approved == true`.
4. Nếu client chọn meeting, backend kiểm tra từng meeting thuộc group rồi thêm filter `meetingId in [...]`.
5. Gọi `Retrieve` hoặc `RetrieveAndGenerate`; không retrieve toàn cục rồi mới post-filter.
6. Chuẩn hóa citation về URI CampusMeet, không trả raw S3 key/URL nhạy cảm.
7. Nếu retrieval rỗng hoặc nguồn không đủ, trả `insufficientContext=true`.

### 7.3 Citation

Citation trên UI phải hiển thị:

- Tên và ngày meeting.
- Loại nguồn: file, transcript hoặc minutes.
- Tên file hoặc speaker/timestamp.
- Link về meeting/source nội bộ.
- Đoạn bằng chứng ngắn nếu người dùng có quyền.

Citation không hợp lệ hoặc trỏ nguồn đã xóa làm generation thất bại an toàn; không trả câu trả lời như đã có căn cứ.

## 8. Thay đổi mã nguồn dự kiến

### Shared contract

- `packages/shared/src/enums/index.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/src/dto/index.ts`

PR contract phải merge trước khi frontend/backend tách nhánh dài.

### API

- `services/api/src/handlers/attachments.ts`
- `services/api/src/handlers/transcripts.ts`
- `services/api/src/handlers/live-transcription.ts`
- `services/api/src/handlers/ai.ts`
- `services/api/src/application/attachments.ts`
- `services/api/src/application/transcripts.ts`
- `services/api/src/application/live-transcription.ts`
- `services/api/src/application/ai.ts`
- `services/api/src/repositories/attachments.ts`
- `services/api/src/repositories/transcripts.ts`
- `services/api/src/repositories/live-transcription-sessions.ts`
- `services/api/src/repositories/ai-jobs.ts`
- `services/api/src/domain/ai-ports.ts`

### AI Worker

Tạo workspace `services/ai-worker/`:

- `src/index.ts`
- `src/providers/speech-to-text.ts`
- `src/providers/amazon-transcribe.ts`
- `src/providers/grounded-generation.ts`
- `src/providers/bedrock-knowledge-base.ts`
- `src/workflows/normalize-transcript.ts`
- `src/workflows/prepare-knowledge-source.ts`
- `src/utils/safe-logging.ts`

### Frontend

- `apps/web/src/features/attachments/`
- `apps/web/src/features/transcripts/`
- `apps/web/src/features/live-transcription/`
- `apps/web/src/features/ai/`

Upload gắn với trang chi tiết meeting. AI UI có hai scope:

- Meeting hiện tại.
- Toàn nhóm hoặc nhiều meeting được chọn.

Mỗi feature có service riêng; không gọi `fetch` trực tiếp rải rác trong component. Upload progress dùng client hỗ trợ upload progress và phải xử lý cancel/retry.

Live frontend chịu trách nhiệm:

- Yêu cầu consent và `getDisplayMedia` từ user gesture; kiểm tra người dùng đã chọn tab có audio.
- Resample/encode audio theo cấu hình Transcribe, mở WebSocket được ký và gửi chunk đều.
- Hiển thị rõ `STARTING/ACTIVE/RECONNECTING/FAILED`, nguồn capture và nút dừng.
- Hiển thị partial segment khác kiểu final segment; gửi final segment theo batch idempotent.
- Tự xin URL mới và resume từ sequence cuối khi reconnect; không âm thầm đổi sang microphone.
- Upload recording chunk của cùng session vào S3 để batch chuẩn hóa sau họp.

### Hạ tầng

`infra/template.yaml` bổ sung:

- S3 user-content bucket và prefix cho normalized KB source.
- DynamoDB Attachments, Recordings/Consents, LiveTranscriptionSessions, Transcripts, AIJobs và AIConversations/KnowledgeSources theo access pattern đã chốt.
- IAM quyền tối thiểu để API ký `StartStreamTranscriptionWebSocket`; không cần dựng WebSocket API riêng trong baseline vì Browser kết nối trực tiếp tới Transcribe bằng URL ký ngắn hạn.
- Step Functions state machine, AI Worker Lambda và log group.
- Bedrock Knowledge Base, S3 data source, S3 vector bucket/index và service role.
- IAM role tách riêng cho API, state machine, AI worker và Knowledge Base.
- Alarms cho job failed/timeout, ingestion failed, retrieval empty/citation missing và cost threshold demo.
- Lifecycle/TTL/cleanup output.

Region chỉ được chốt sau khi kiểm tra giao của Transcribe `vi-VN`, model generation, embedding model, Bedrock Knowledge Bases và S3 Vectors. Model ID/dimension là cấu hình; không hard-code một model/version vào domain.

## 9. Critical path và trình tự PR

| PR    | Ước lượng | Phạm vi                                                                                                              | Gate để merge                                                                                                                                                                   |
| ----- | --------: | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5-00 |    1 ngày | Spike thật: capture tab audio → PCM → Transcribe WebSocket `vi-VN`                                                   | Chrome demo nhận được partial/final segment, stop sạch và reconnect bằng URL mới; ghi lại Region/sample rate/encoding. Không đạt thì dừng và đổi kiến trúc trước khi code tiếp. |
| M5-01 |  1,5 ngày | Shared contract, trạng thái, DTO, error code, citation schema và access pattern                                      | M1/M2/M3 review; không copy type sang frontend; typecheck và contract test pass.                                                                                                |
| M5-02 |    2 ngày | S3 presigned upload, Attachment repository, complete verification và UI upload                                       | Sai MIME/size/checksum bị từ chối; binary không qua API; complete/retry không tạo job trùng; nhóm khác nhận `403`.                                                              |
| M5-03 |    2 ngày | Live session backend: consent, membership, quota, signed Transcribe URL, session/heartbeat/stop và final-segment API | Chưa consent không cấp URL; URL ngắn hạn; session/sequence idempotent; stream lỗi tạo trạng thái an toàn.                                                                       |
| M5-04 |    3 ngày | Browser capture/PCM/WebSocket, recording upload, reconnect và live-status UI                                         | Stream chạy nền sau user gesture; không âm thầm đổi nguồn; partial chỉ hiển thị; final segment được lưu; raw recording lên S3.                                                  |
| M5-05 |    2 ngày | Finalize/batch normalize, Transcript API/editor, timestamp playback, speaker mapping và optimistic version           | Batch dùng recording cùng session; sửa version cũ trả `409`; confidence thấp được đánh dấu; không tự đoán speaker.                                                              |
| M5-06 |  1,5 ngày | AIJob, Step Functions, AI Worker và fake provider cho parse/normalize/ingestion                                      | Success/failure/cancel/retry chạy idempotent; API không chờ job dài; log không chứa nội dung nhạy cảm.                                                                          |
| M5-07 |    2 ngày | Knowledge Base + S3 Vectors, normalized source, metadata và ingestion một meeting                                    | Chỉ nguồn `approved=true` được index; version cũ thành `STALE`; citation mở đúng source nội bộ.                                                                                 |
| M5-08 |    2 ngày | Group RAG nhiều meeting, ACL/filter, chat UI và citation UI                                                          | Một câu hỏi trả citation từ ít nhất hai meeting cùng group; group B không có chunk nào được gửi cho model; thiếu nguồn trả `insufficientContext=true`.                          |
| M5-09 |  1,5 ngày | Minutes/action-item draft từ live transcript đã duyệt                                                                | Draft gồm tóm tắt/quyết định/action item và citation; không ghi minutes/task trước khi M3/user xác nhận.                                                                        |
| M5-10 |  1,5 ngày | Alarm, metric, cost/quota, retention, cleanup, security test và demo evidence                                        | Có failure alarm, token/phút/chi phí ước tính, cleanup xuyên S3/DynamoDB/KB/vector và checklist demo hoàn chỉnh.                                                                |

Tổng: **20 ngày làm việc**. Mỗi PR chỉ merge khi gate của chính nó đạt; không gộp toàn bộ SAM, API, frontend và RAG vào một PR.

## 10. Lịch thực hiện bốn tuần

| Tuần   | Mục tiêu                                                  | PR chính      | Kết quả cuối tuần                                                                           |
| ------ | --------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| Tuần 1 | Loại rủi ro streaming, khóa contract và hoàn thành upload | M5-00 → M5-02 | Có spike `vi-VN`, contract được review, file upload thẳng S3 và tạo Attachment an toàn.     |
| Tuần 2 | Hoàn thành nguồn nội dung cuộc họp                        | M5-03 → M5-05 | Một meeting chạy live nền, lưu final segment, có recording đối soát và transcript editor.   |
| Tuần 3 | Hoàn thành ingestion và RAG nhiều cuộc họp                | M5-06 → M5-08 | Hai meeting cùng nhóm được index và hỏi đáp có citation chéo meeting, không rò chéo nhóm.   |
| Tuần 4 | Hoàn thành giá trị sau họp và vận hành                    | M5-09 → M5-10 | Minutes/action-item draft có citation, alarm/cost/cleanup/test/demo đạt Definition of Done. |

Nếu dependency M1/M2 chậm, M5 tiếp tục với fake repository trong unit test nhưng không được nghiệm thu M5-03/M5-08 cho đến khi authorization và meeting repository thật được tích hợp.

## 11. Verification và Definition of Done

### 11.1 Automated test bắt buộc

Contract/domain:

- Parse/validate mọi DTO, enum state transition và error code.
- `meetingId` luôn ánh xạ về `groupId` phía server; không tin `groupId` trong body.
- Session, final segment, complete upload, AIJob và ingestion đều idempotent.

Upload/live/transcript:

- File sai MIME/đuôi/size/checksum; presigned URL hết hạn; complete object không tồn tại.
- Chưa consent, sai membership, session hết quota hoặc meeting sai trạng thái không được cấp URL streaming.
- Partial segment không được lưu/index; final segment gửi lại cùng `ResultId/sequence` không tạo trùng.
- Reconnect tiếp tục từ sequence cuối; stop hai lần cho cùng kết quả.
- Stream `FAILED` khóa các chức năng AI phụ thuộc nội dung và không suy đoán từ agenda/participant metadata.
- Transcript update version cũ trả `409`; người không quyền sửa nhận `403`.

Job/RAG/generation:

- Retry state machine không tạo transcript/ingestion trùng; timeout chuyển job sang `FAILED`.
- Ingestion version mới làm version cũ `STALE`.
- Query một meeting chỉ trả nguồn meeting đó.
- Query nhiều meeting trả citation từ ít nhất hai meeting cùng group.
- Query group A không retrieve hoặc gửi chunk group B vào model.
- Câu không có nguồn trả `insufficientContext=true`.
- Prompt injection trong source không thay đổi filter, system instruction hoặc kích hoạt tool.
- Minutes/action-item chỉ là draft; confirm/replay không tạo task trùng.

Vận hành:

- Log không chứa audio, transcript, prompt, token, presigned URL hoặc model response nhạy cảm.
- Alarm chuyển trạng thái khi cố ý gây lỗi job/stream.
- Cleanup xóa object, transcript, normalized source, vector/reference và job liên quan.

### 11.2 Quality gate cho mỗi PR

```text
npm run lint
npm run typecheck
npm run test
npm run build
npm run format:check
sam validate --lint --template-file infra/template.yaml
sam build --template-file infra/template.yaml
```

PR chỉ được merge khi các lệnh liên quan pass hoặc có issue/blocker được cả nhóm chấp nhận bằng văn bản.

### 11.3 Kịch bản demo cuối

1. Đăng nhập bằng thành viên nhóm A và tạo hai meeting.
2. Ở từng meeting, xác nhận consent, chọn tab Meet có audio và thấy session chuyển `ACTIVE`.
3. Nói nội dung khác nhau; xác nhận partial thay đổi nhưng chỉ final segment được lưu.
4. Ngắt mạng ngắn, reconnect và xác nhận không mất/nhân đôi sequence.
5. Dừng meeting, chờ batch chuẩn hóa; sửa một đoạn và ánh xạ speaker.
6. Duyệt transcript và chờ cả hai KnowledgeSource thành `INDEXED`.
7. Hỏi một câu cần bằng chứng từ cả hai meeting; mở citation đúng timestamp của từng meeting.
8. Giới hạn scope về một meeting và xác nhận citation meeting còn lại biến mất.
9. Sinh minutes/action-item draft, chỉnh sửa và xác nhận AI chưa tự tạo task.
10. Dùng tài khoản nhóm B để thử đọc/query nguồn nhóm A và nhận `403` hoặc không có kết quả.
11. Gây một lỗi có kiểm soát, kiểm tra alarm/log an toàn, số liệu chi phí và chạy cleanup.

### 11.4 Definition of Done M5

M5 chỉ hoàn thành khi:

- M5-00 đến M5-10 đã merge qua review và không còn mock trên production path.
- Luồng demo 11 bước chạy đầu-cuối trên môi trường dev thật.
- Có test tự động cho happy path, authorization chéo nhóm, idempotency, stream failure, citation và prompt injection.
- Có evidence gồm ảnh/video UI, response API, CloudWatch metric/alarm, chi phí ước tính và kết quả cleanup.
- SRS, API contract, architecture, hướng dẫn deploy và kế hoạch nhóm khớp với code thực tế.

## 12. Quyết định phải khóa

| Deadline    | Nội dung                        | Giá trị mặc định để triển khai nếu nhóm không phản đối                                                                              |
| ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Trước M5-00 | Trình duyệt/nguồn capture       | Chrome desktop; người dùng chọn tab Google Meet và bật tab audio; không tự fallback microphone.                                     |
| Trong M5-00 | Region, sample rate và encoding | Chọn Region là giao của Transcribe `vi-VN`, Bedrock model, Knowledge Bases và S3 Vectors; spike quyết định PCM/sample rate thực tế. |
| Trước M5-01 | File allowlist                  | Audio và TXT baseline; PDF/DOCX chỉ thêm khi parser/validation có test.                                                             |
| Trước M5-01 | Giới hạn demo                   | Một live session/user, tối đa 60 phút/meeting và quota phút theo môi trường.                                                        |
| Trước M5-01 | Retention                       | Đề xuất raw audio 7 ngày; transcript/normalized source/vector 30 ngày ở dev, nhưng phải cho phép xóa sớm theo quyền.                |
| Trước M5-06 | Model config                    | Generation model, embedding model/dimension đều là environment config, không hard-code.                                             |
| Trước M5-07 | Chunking/citation               | Chunk theo segment/time window, giữ mapping segment/timestamp; citation dùng URI CampusMeet, không lộ S3 key.                       |
| Trước M5-08 | ACL                             | Group-wide baseline; filter `groupId` và `approved=true` bắt buộc, `meetingId` tùy scope.                                           |
| Trước M5-10 | Cost quota                      | Giới hạn phút STT, token/query, số ingestion và ngưỡng alarm demo.                                                                  |

Email SES, public Marketplace, Document PiP, reranking và tool proposal nhiều miền không phải blocker. Live transcription và RAG nhiều cuộc họp là blocker bắt buộc của nghiệm thu M5.

## 13. Tài liệu kỹ thuật chính

- [Amazon Transcribe supported languages](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html)
- [Amazon Transcribe streaming WebSocket setup](https://docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html)
- [Amazon Transcribe streaming partial/final results](https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.html)
- [Amazon Transcribe speaker diarization](https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html)
- [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Bedrock Knowledge Bases retrieval](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-how-retrieval.html)
- [Bedrock Knowledge Bases metadata filtering](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html)
- [Bedrock Knowledge Bases with S3 Vectors](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html)
- [S3 Vectors metadata filtering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-metadata-filtering.html)
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
