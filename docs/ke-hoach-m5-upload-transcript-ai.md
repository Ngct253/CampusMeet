# Kế hoạch M5 — Upload, Transcript và RAG nhiều cuộc họp

Tài liệu này là kế hoạch triển khai chính thức cho phạm vi M5. Phạm vi bao gồm live transcription tiếng Việt chạy nền trong phiên họp, upload an toàn, xử lý AI bất đồng bộ, hỏi đáp/sinh bản nháp có citation và RAG trên nhiều cuộc họp trong cùng nhóm.

> **Quyết định đã chốt:** RAG nhiều cuộc họp không bị loại khỏi M5. Nhóm triển khai pipeline một meeting trước để kiểm chứng ingestion/citation, sau đó mở truy vấn nhiều meeting bằng cùng Knowledge Base và filter `groupId`/ACL. Đây là thứ tự triển khai, không phải giảm phạm vi.

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

| Phụ thuộc        | Owner cung cấp     | M5 cần                                                                                                  |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| Group/membership | M1                 | Hàm kiểm tra active membership/role theo`groupId`; M5 không tin `groupId` client gửi nếu chưa kiểm tra. |
| Meeting          | M2                 | `meetingId`, `groupId`, trạng thái meeting và quyền xem meeting.                                        |
| Minutes/task     | M3                 | Contract nhận minutes/action-item draft và luồng duyệt trước khi tạo task.                              |
| Google artifact  | M4                 | Recording/transcript reference khi Google Meet artifact tồn tại; M5 vẫn hỗ trợ upload fallback.         |
| AWS dùng chung   | Cả nhóm, M5 review | Region, CloudFront origin, Cognito claims, naming/tagging và budget.                                    |

M5 có thể dùng fake repository/provider đúng contract khi dependency chưa hoàn thành; không hard-code membership hoặc meeting giả vào production handler.

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
| POST   | `/meetings/{meetingId}/attachments/{attachmentId}/complete`             | Xác minh object; trả`202` cùng `aiJobId` khi tạo job.                          |
| GET    | `/ai/jobs/{aiJobId}`                                                    | Đọc trạng thái/progress/lỗi an toàn.                                           |
| POST   | `/meetings/{meetingId}/transcripts`                                     | Tạo transcription job idempotent.                                              |
| GET    | `/meetings/{meetingId}/transcripts`                                     | Lấy transcript và segment theo trang.                                          |
| PATCH  | `/meetings/{meetingId}/transcripts/{transcriptId}/segments/{segmentId}` | Sửa text/speaker với`expectedVersion`; version cũ trả `409`.                   |
| POST   | `/meetings/{meetingId}/live-transcription`                              | Sau consent, tạo phiên streaming idempotent và trả thông tin kết nối ngắn hạn. |
| POST   | `/meetings/{meetingId}/live-transcription/{sessionId}/stop`             | Kết thúc stream, chốt sequence cuối và kích hoạt bước chuẩn hóa sau họp.       |
| POST   | `/meetings/{meetingId}/ai/chat`                                         | Hỏi trong một meeting, trả`202`/job hoặc response theo contract đã chốt.       |
| POST   | `/groups/{groupId}/ai/search`                                           | RAG trên nhiều meeting cùng nhóm; nhận`meetingIds?`.                           |
| POST   | `/meetings/{meetingId}/ai/minutes-draft`                                | Sinh minutes/action-item draft có citation.                                    |

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
- `services/api/src/handlers/ai.ts`
- `services/api/src/application/attachments.ts`
- `services/api/src/application/transcripts.ts`
- `services/api/src/application/ai.ts`
- `services/api/src/repositories/attachments.ts`
- `services/api/src/repositories/transcripts.ts`
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
- `apps/web/src/features/ai/`

Upload gắn với trang chi tiết meeting. AI UI có hai scope:

- Meeting hiện tại.
- Toàn nhóm hoặc nhiều meeting được chọn.

Mỗi feature có service riêng; không gọi `fetch` trực tiếp rải rác trong component. Upload progress dùng client hỗ trợ upload progress và phải xử lý cancel/retry.

### Hạ tầng

`infra/template.yaml` bổ sung:

- S3 user-content bucket và prefix cho normalized KB source.
- DynamoDB Attachments, Recordings/Consents, Transcripts, AIJobs và AIConversations/KnowledgeSources theo access pattern đã chốt.
- Step Functions state machine, AI Worker Lambda và log group.
- Bedrock Knowledge Base, S3 data source, S3 vector bucket/index và service role.
- IAM role tách riêng cho API, state machine, AI worker và Knowledge Base.
- Alarms cho job failed/timeout, ingestion failed, retrieval empty/citation missing và cost threshold demo.
- Lifecycle/TTL/cleanup output.

Region chỉ được chốt sau khi kiểm tra giao của Transcribe `vi-VN`, model generation, embedding model, Bedrock Knowledge Bases và S3 Vectors. Model ID/dimension là cấu hình; không hard-code một model/version vào domain.

## 9. Trình tự PR đề xuất

| PR     | Phạm vi                                                            | Gate                                                                                                                                              |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5-01  | Contract, status, citation schema, access pattern và upload policy | M1/M2/M3 review dependency; typecheck pass.                                                                                                       |
| M5-02  | S3 upload + Attachment repository + complete verification          | Sai MIME/size/checksum bị từ chối; binary không qua API.                                                                                          |
| M5-03  | AIJob + Step Functions + AI Worker skeleton với fake provider      | Job chạy đủ success/failure/cancel và idempotent.                                                                                                 |
| M5-04  | Amazon Transcribe`vi-VN` + normalize segment                       | Có timestamp/confidence/speaker ẩn danh trên audio demo.                                                                                          |
| M5-05  | Transcript API/editor + optimistic version                         | Sửa/nghe/map speaker; version cũ trả`409`.                                                                                                        |
| M5-05A | Live transcription session + streaming ingest                      | Sau consent, stream chạy nền; segment final được lưu theo sequence; reconnect không tạo trùng; stream lỗi khóa các AI feature phụ thuộc nội dung. |
| M5-06  | Knowledge Base/S3 Vectors + normalized source + ingestion tracking | Một meeting được index, citation mở đúng source.                                                                                                  |
| M5-07  | Group RAG nhiều meeting + filter/ACL + minutes draft               | Hai meeting cùng nhóm trả citation; nhóm khác không bị retrieve.                                                                                  |
| M5-08  | Monitoring, retention, cleanup, cost và demo evidence              | Alarm/failure/cleanup test có bằng chứng.                                                                                                         |

Không gộp toàn bộ SAM, API, frontend và RAG vào một PR.

## 10. Verification

### Automated

- File sai MIME/đuôi/size/checksum.
- Presigned URL hết hạn hoặc complete object không tồn tại.
- Complete gọi lại không tạo job trùng.
- User nhóm A không upload/read/query meeting nhóm B.
- Retry state machine không tạo transcript/ingestion trùng.
- Transcribe/provider timeout chuyển job sang `FAILED`.
- Transcript update version cũ trả `409`.
- Ingestion version mới làm version cũ stale/không còn là nguồn current.
- Query một meeting chỉ trả source meeting đó.
- Query nhiều meeting trả citation từ ít nhất hai meeting cùng group.
- Query group A không gửi chunk group B vào model.
- Câu không có nguồn trả `insufficientContext=true`.
- Citation mở đúng segment/timestamp và người không quyền nhận `403`.
- Prompt injection trong source không thay đổi filter hoặc gọi tool.
- Log không chứa nội dung nhạy cảm.

### Manual demo

1. Tạo hai meeting trong cùng group.
2. Xác nhận consent/cấp quyền và chạy live transcription cho từng meeting.
3. Xác nhận segment final được lưu liên tục; kết thúc stream và theo dõi bước chuẩn hóa tới `COMPLETED`.
4. Sửa transcript và ánh xạ speaker.
5. Chờ ingestion của cả hai source thành `INDEXED`.
6. Hỏi câu cần thông tin từ cả hai meeting.
7. Mở citation của từng meeting.
8. Chọn chỉ một meeting và xác nhận nguồn ngoài scope không xuất hiện.
9. Dùng tài khoản group khác và xác nhận không retrieve được dữ liệu.
10. Gây một job lỗi có kiểm s| col1 | col2 | col3 |
    | ---- | ---- | ---- |
    | | | |
    | | | |

    oát, kiểm tra alarm/log an toàn và chạy cleanup.

## 11. Điểm cần chốt trước M5-01

| Nội dung              | Quyết định cần có                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------- |
| AWS Region            | Giao của Transcribe`vi-VN`, Bedrock generation/embedding, Knowledge Bases và S3 Vectors. |
| File allowlist        | Audio/TXT baseline; PDF/DOCX chỉ thêm khi parser/validation đã chốt.                     |
| Kích thước/thời lượng | Giới hạn demo để kiểm soát Lambda, STT và chi phí.                                       |
| Retention             | Số ngày cho raw audio, transcript, conversation, normalized source và vector.            |
| Model config          | Generation model, embedding model/dimension và environment variables.                    |
| Chunking              | Chiến lược baseline và evaluation dataset tối thiểu.                                     |
| Citation              | Schema, URI nội bộ và hành vi khi source bị sửa/xóa.                                     |
| ACL                   | Group-wide baseline hay có document-level restriction; filter bắt buộc tương ứng.        |
| Cost quota            | Giới hạn phút STT, token/query, ingestion và alarm demo.                                 |

Email SES, public Marketplace và tool proposal không phải blocker của M5-01. Live transcription là đầu vào bắt buộc của AI nội dung và phải được hoàn thành trước khi nghiệm thu luồng M5 đầu-cuối.

## 12. Tài liệu kỹ thuật chính

- [Amazon Transcribe supported languages](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html)
- [Amazon Transcribe speaker diarization](https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html)
- [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Bedrock Knowledge Bases retrieval](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-how-retrieval.html)
- [Bedrock Knowledge Bases metadata filtering](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html)
- [Bedrock Knowledge Bases with S3 Vectors](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html)
- [S3 Vectors metadata filtering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-metadata-filtering.html)
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
