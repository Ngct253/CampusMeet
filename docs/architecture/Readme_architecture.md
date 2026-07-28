# Kiến trúc triển khai AWS của CampusMeet

> **Phạm vi tài liệu:** mô tả kiến trúc mục tiêu của CampusMeet trên AWS, các luồng runtime chính, mô hình dữ liệu v2, thành phần AI, nguyên tắc bảo mật và trạng thái triển khai hiện tại.  
> **Sơ đồ nguồn:** [`campusmeet-aws-architecture.drawio`](./campusmeet-aws-architecture.drawio)

---

## 1. Tổng quan

CampusMeet được thiết kế theo kiến trúc **managed serverless trên AWS**, trong đó CampusMeet Web là sản phẩm chính và Google Meet Add-on chỉ là một bề mặt client dùng chung API, dữ liệu và cơ chế phân quyền.

Kiến trúc ưu tiên:

- giảm công việc quản trị máy chủ;
- tự động mở rộng theo tải;
- tách biệt rõ frontend, API, dữ liệu, file, thông báo và AI;
- bảo vệ dữ liệu theo `groupId`, membership, role, ACL và trạng thái nguồn;
- xử lý file lớn và AI theo mô hình bất đồng bộ;
- triển khai hạ tầng bằng mã nguồn thông qua AWS SAM/CloudFormation;
- theo dõi hệ thống bằng CloudWatch, SNS và AWS Budgets.

Trong phạm vi MVP, kiến trúc không yêu cầu EC2, ECS/EKS, RDS, VPC hoặc NAT Gateway. Các dịch vụ cốt lõi đều là dịch vụ AWS managed hoặc serverless.

Sơ đồ Draw.io gồm hai trang chính:

1. **Target MVP Architecture** – kiến trúc AWS mục tiêu.
2. **MVP Runtime Flows** – các luồng xử lý quan trọng của hệ thống.

---

## 2. Trạng thái hiện tại

Repository đang chuyển từ scaffold sang các vertical slice nghiệp vụ thật.

| Hạng mục | Trạng thái |
|---|---|
| Authentication | Cognito authentication đã được triển khai và kiểm thử bằng stack integration riêng; stack kiểm thử trước đó đã cleanup |
| Frontend | Nền tảng React/TypeScript đã có, nhưng nhiều màn hình nghiệp vụ vẫn còn mock |
| Backend API | API nghiệp vụ và DynamoDB repository còn skeleton/TODO ở nhiều phần |
| Persistence | Việc bảng tồn tại trên AWS không đồng nghĩa backend đã đọc/ghi persistence thật |
| M5 | Phạm vi đã chốt gồm upload an toàn, live transcription, AIJob, transcript, Bedrock RAG nhiều meeting và citation |
| DynamoDB legacy | Account dev hiện có 17 bảng legacy; chưa phải source of truth mới và không được xóa trước audit/backup |
| Data model v2 | Dùng 5 bảng vật lý, định nghĩa trong `infra/data-foundation.yaml` |
| AI pipeline | Là kiến trúc mục tiêu; mức hoàn thiện thực tế phải được xác nhận bằng code, CloudFormation output, smoke test và logs |

Chi tiết mô hình dữ liệu xem tại [Mô hình DynamoDB v2](../dynamodb-data-model.md).

---

## 3. Kiến trúc tổng thể

Kiến trúc được chia thành bảy lớp:

1. **Clients**
2. **Global edge and frontend**
3. **Authentication, API and business services**
4. **Data foundation**
5. **Files and external integrations**
6. **Reminder and notification**
7. **AI, security, observability and deployment**

Luồng tổng quát:

```text
User / Browser
  ├─→ CloudFront → S3 private frontend
  ├─→ Cognito User Pool
  ├─→ API Gateway HTTP API → API Lambda → DynamoDB
  ├─→ S3 private user-content
  └─→ Amazon Transcribe

API Lambda
  ├─→ EventBridge Scheduler → Reminder Lambda → SES
  ├─→ Google Calendar / Google Meet APIs
  └─→ Step Functions → AI Worker → Bedrock / Knowledge Bases / S3 Vectors

CloudWatch
  └─→ SNS alerts
```

---

## 4. Clients

### 4.1. CampusMeet Web Browser

CampusMeet Web là client chính, thực hiện:

- đăng ký và đăng nhập;
- quản lý group, meeting, attendee, agenda, minutes và task;
- tải file hoặc audio;
- khởi tạo live transcription sau khi người dùng đồng ý;
- xem transcript, kết quả AI và citation;
- xem trước rồi xác nhận task/tool proposal.

### 4.2. Google Meet Add-on

Google Meet Add-on là side panel chạy trong ngữ cảnh Google Meet.

Add-on:

- tải route frontend qua HTTPS;
- gọi cùng API Gateway và API Lambda với CampusMeet Web;
- dùng chung JWT, membership, role và authorization;
- không có data store hoặc business rule riêng.

### 4.3. GitHub Actions

GitHub Actions thực hiện:

- pull request quality gates;
- kiểm tra build và test;
- triển khai stack đã được phê duyệt;
- gọi AWS SAM/CloudFormation để cập nhật hạ tầng.

---

## 5. Global edge và frontend

### 5.1. Amazon CloudFront

CloudFront là điểm truy cập toàn cầu cho frontend CampusMeet.

Vai trò:

- phân phối React assets qua HTTPS;
- cache static assets;
- che giấu S3 origin;
- cung cấp một endpoint ổn định cho CampusMeet Web và route của Google Meet Add-on.

### 5.2. S3 private frontend bucket

Frontend được lưu trong S3 private bucket. Bucket không cho phép public access trực tiếp.

CloudFront truy cập bucket thông qua **Origin Access Control (OAC)**.

```text
Browser / Meet Add-on
  → HTTPS
CloudFront
  → OAC private origin
S3 private frontend bucket
```

---

## 6. Xác thực, API và phân quyền

### 6.1. Amazon Cognito User Pool

Cognito chịu trách nhiệm:

- đăng ký và đăng nhập;
- quản lý user pool;
- phát hành JWT;
- cung cấp thông tin định danh cho frontend.

Frontend gửi JWT trong header:

```http
Authorization: Bearer <access-token>
```

### 6.2. API Gateway HTTP API

API Gateway là public entry point cho API CampusMeet.

JWT authorizer kiểm tra:

- issuer;
- audience;
- thời hạn token;
- chữ ký và khóa công khai;
- token có thuộc đúng Cognito User Pool hay không.

API Gateway chỉ invoke Lambda khi token hợp lệ.

### 6.3. API Lambda

API Lambda chứa application service và business service của hệ thống.

Sau khi xác thực JWT, backend tiếp tục kiểm tra quyền nghiệp vụ:

- user có phải active member của group hay không;
- user có quyền với `groupId` hoặc `meetingId` được yêu cầu hay không;
- role hiện tại là owner, admin hay member;
- attendee hoặc assignee có còn là active member hay không;
- mutation có thỏa optimistic version và idempotency hay không.

Phân biệt hai lớp kiểm tra:

| Lớp | Mục đích |
|---|---|
| API Gateway JWT authorizer | Xác định request đến từ người dùng đã đăng nhập hợp lệ |
| Application authorization | Xác định người dùng được phép đọc hoặc thay đổi tài nguyên nào |

Luồng API:

```text
Browser / Meet Add-on
  → REST API + Bearer JWT
API Gateway HTTP API
  → JWT validation
API Lambda
  → membership / role / resource checks
Repository interfaces
  → DynamoDB
```

---

## 7. Data foundation v2

DynamoDB data foundation v2 sử dụng đúng **5 bảng vật lý**.

| Bảng | Aggregate chính |
|---|---|
| `identity` | User, preference, Google integration reference, OAuth state, notification |
| `collaboration` | Group, membership, invitation, audit event |
| `meeting-data` | Meeting, attendee, agenda, minutes, reminder, attachment metadata, recording, consent, live session, transcript và segment |
| `task-data` | Task, task history và index theo group, assignee hoặc meeting |
| `ai-work` | AIJob, KnowledgeSource, conversation, message, citation, task/tool proposal và idempotency |

Mỗi entity logic vẫn tồn tại độc lập. Việc gom bảng được thực hiện bằng:

- composite `PK/SK`;
- item collection;
- sparse GSI;
- conditional write;
- transaction khi mutation liên quan nhiều item.

Không gom toàn bộ project vào một item hoặc một partition duy nhất.

### 7.1. Trách nhiệm của hai stack

- `infra/data-foundation.yaml` là **data stack độc lập**, chịu trách nhiệm tạo 5 bảng.
- `infra/template.yaml` là **application stack**, chỉ tham chiếu tên bảng thông qua `DataTablePrefix`.
- Application stack không tạo lại DynamoDB table.

### 7.2. Nguyên tắc truy cập

- Không dùng `Scan` trong request nghiệp vụ thông thường.
- Query phải đi qua key hoặc index đã thiết kế.
- Mọi thao tác group-scoped phải kiểm tra membership.
- Timestamp lưu UTC; frontend hiển thị theo timezone người dùng.
- Một group luôn phải còn ít nhất một active Group Admin.

---

## 8. File storage và upload an toàn

### 8.1. S3 private user-content bucket

Bucket `user-content` lưu:

- file người dùng;
- audio;
- recording fallback;
- tài liệu nguồn;
- dữ liệu chuẩn hóa phục vụ Knowledge Base.

Binary và vector không được lưu trong DynamoDB. DynamoDB chỉ giữ metadata, trạng thái và tham chiếu object.

### 8.2. Presigned upload

Tệp lớn không đi qua API Gateway hoặc Lambda payload.

Luồng upload:

1. Browser gửi yêu cầu tạo upload.
2. API Lambda kiểm tra authentication, membership và quyền tài nguyên.
3. Backend kiểm tra MIME, size, checksum và object key.
4. API trả presigned URL.
5. Browser upload binary trực tiếp vào S3.
6. Complete-upload gọi `HeadObject` để xác nhận object và checksum.
7. Complete-upload hợp lệ tạo đúng một `AIJob` idempotent.
8. Step Functions bắt đầu xử lý bất đồng bộ.

```text
Browser
  → Presign request
API Lambda
  → Presigned URL
Browser
  → Direct upload
S3 user-content
  → Complete + HeadObject + checksum
AIJob
  → Step Functions
```

Các chính sách áp dụng:

- allow-list MIME type;
- giới hạn kích thước;
- checksum;
- object key theo scope;
- lifecycle;
- retention;
- consent đối với audio, transcript và conversation.

---

## 9. Tích hợp Google Calendar và Google Meet

CampusMeet không xây dựng video call hoặc WebRTC riêng.

### 9.1. Google Calendar

Calendar API là luồng chính để:

- tạo event;
- cập nhật event;
- hủy event;
- tạo hoặc cập nhật Meet link.

### 9.2. Google Meet REST API

Meet REST API chỉ được sử dụng để lấy artifact khi:

- artifact thực sự tồn tại;
- OAuth scope cho phép;
- quyền của tài khoản Google phù hợp.

Artifact có thể bao gồm participant metadata, recording hoặc transcript tùy khả năng API và quyền thực tế.

Vì artifact không luôn sẵn có, upload hoặc recording fallback vẫn bắt buộc.

### 9.3. Google integration adapter

Adapter chịu trách nhiệm:

- cô lập logic Google khỏi business service;
- quản lý idempotent state;
- dùng token/secret reference;
- xử lý retry và fallback;
- không giả lập distributed transaction với dịch vụ Google.

Secret và token reference được lưu bằng:

- AWS Secrets Manager; hoặc
- SSM Parameter Store `SecureString`.

```text
API Lambda
  → Google integration adapter
  ├─→ Secrets Manager / SSM
  ├─→ Google OAuth / Calendar API
  └─→ Google Meet REST API
```

---

## 10. Reminder và notification

### 10.1. EventBridge Scheduler

Mỗi reminder sử dụng one-time schedule.

Khi meeting hoặc reminder thay đổi, API Lambda tạo hoặc cập nhật schedule tương ứng.

### 10.2. Reminder Lambda

Đến thời điểm đã định:

1. EventBridge Scheduler invoke Reminder Lambda.
2. Reminder Lambda đọc dữ liệu meeting từ `meeting-data`.
3. Lambda ghi notification vào `identity`.
4. Lambda thử gửi email qua SES nếu email được bật.

Thông báo trong ứng dụng là dữ liệu chính. Lỗi gửi email không rollback notification.

```text
API Lambda
  → create/update one-time schedule
EventBridge Scheduler
  → Reminder Lambda
  ├─→ meeting-data
  ├─→ identity notification
  └─→ Amazon SES → Email recipient
```

---

## 11. AI MVP

AI trong CampusMeet gồm ba nhóm luồng:

1. live transcription;
2. batch processing và Knowledge Source ingestion;
3. RAG nhiều meeting và controlled mutation.

AI output luôn là draft hoặc proposal có citation. AI không tự động thực hiện mutation nghiệp vụ.

---

## 12. Live transcription

### 12.1. Khởi tạo phiên

Live transcription chỉ bắt đầu sau:

- user gesture;
- consent;
- kiểm tra quyền với meeting.

Frontend hiển thị trạng thái:

- `STARTING`;
- `ACTIVE`;
- `RECONNECTING`;
- `FAILED`.

### 12.2. Amazon Transcribe

Browser gửi audio stream tới Amazon Transcribe qua signed WebSocket.

Yêu cầu STT:

- giữ ngôn ngữ đang nói;
- ưu tiên chất lượng tiếng Việt;
- có thể hỗ trợ multilingual;
- chỉ gắn `Speaker N`;
- không tự suy đoán danh tính người nói.

### 12.3. Partial và final segment

- Partial transcript chỉ hiển thị tạm thời.
- Partial transcript không được lưu hoặc ingest.
- Chỉ final segment được gửi về API.
- Final segment được ghi idempotent theo `sessionId + sequence` hoặc `ResultId`.

```text
Browser consent + capture
  → Signed WebSocket audio
Amazon Transcribe
  → Partial result: display only
  → Final result
API Lambda
  → idempotent persist
DynamoDB meeting-data
```

Voice hoặc live transcript là nguồn nội dung phát biểu. Agenda và participant metadata không được dùng để suy đoán người dùng đã nói gì.

---

## 13. AIJob và xử lý bất đồng bộ

Complete-upload hợp lệ tạo một `AIJob` trong `ai-work`.

Step Functions điều phối:

- parse;
- batch STT;
- normalize;
- source preparation;
- Knowledge Base ingestion;
- generation;
- cập nhật trạng thái job.

AI Worker Lambda thực hiện các bước xử lý ứng dụng và gọi Amazon Bedrock khi cần.

Trạng thái AIJob phải được cập nhật an toàn, có retry và idempotency. Việc gọi dịch vụ ngoài không được giả lập như một distributed transaction.

```text
S3 user-content
  → AIJob
Step Functions
  → Amazon Transcribe hoặc STT adapter
  → AI Worker Lambda
  → Amazon Bedrock
  → Knowledge Source metadata / job state
DynamoDB ai-work
```

Deepgram có thể được dùng dưới dạng **optional STT adapter** nếu được cấu hình. Amazon Transcribe vẫn là dịch vụ AWS chính trong kiến trúc mục tiêu.

---

## 14. Bedrock RAG nhiều meeting

### 14.1. Nguồn được phép ingest

Chỉ những nguồn đã được phê duyệt mới được ingest, ví dụ:

- approved transcript;
- approved minutes;
- approved file;
- nguồn chuẩn hóa có metadata đầy đủ.

Chat current-meeting có thể đọc final segment được phép trực tiếp. Selected-meeting hoặc whole-group RAG sử dụng các nguồn đã approved trong Knowledge Base.

### 14.2. Metadata filter

Nguồn Knowledge Base phải có metadata có thể filter:

- `groupId`;
- `meetingId`;
- `sourceType`;
- `sourceId`;
- `version`;
- `approved`.

Retrieval phải filter:

1. group;
2. tập meeting được chọn;
3. ACL;
4. source status;
5. approved state;

trước khi model nhận chunk.

### 14.3. Bedrock Knowledge Bases và S3 Vectors

- **Amazon Bedrock** cung cấp model và generation.
- **Bedrock Knowledge Bases** quản lý grounded retrieval.
- **S3 Vectors** lưu vector index.
- S3 lưu nội dung nguồn đã chuẩn hóa.
- DynamoDB chỉ lưu KnowledgeSource, job, conversation, citation và control metadata.

Luồng RAG:

```text
Approved normalized source
  → metadata and ACL filter
Bedrock Knowledge Bases
  → vector retrieval
S3 Vectors
  → grounded context
Amazon Bedrock
  → answer or draft with citations
```

---

## 15. Citation và controlled mutation

AI output phải gắn citation tới nguồn được phép.

Task hoặc tool proposal chỉ được thực thi sau:

1. hiển thị preview;
2. người dùng xác nhận;
3. backend kiểm tra authorization;
4. backend kiểm tra optimistic version;
5. backend kiểm tra idempotency;
6. standard business API thực hiện mutation.

```text
Grounded AI result
  → Draft + citations
  → Preview
  → User confirmation
  → Authorization + version + idempotency
  → Standard business API
```

AI không được:

- tự tạo hoặc thay đổi task khi chưa xác nhận;
- suy đoán nội dung phát biểu từ agenda;
- nhận diện danh tính speaker chỉ từ audio;
- đánh giá cá nhân khi phân tích tiến độ.

Phân tích tiến độ chỉ diễn giải snapshot task/meeting do backend tính.

---

## 16. Bảo mật và quyền riêng tư

### 16.1. IAM

Lambda sử dụng IAM execution role theo nguyên tắc least privilege.

Không được:

- hard-code AWS access key;
- lưu AWS credential trong source code;
- cấp quyền wildcard không cần thiết;
- cho phép public access tới bucket private.

### 16.2. Dữ liệu nhạy cảm

Consent và retention được áp dụng cho:

- audio;
- recording;
- transcript;
- file;
- conversation;
- nguồn Knowledge Base.

Application log không ghi:

- nội dung transcript nhạy cảm;
- token;
- secret;
- presigned URL đầy đủ;
- nội dung file;
- thông tin xác thực Google.

### 16.3. Tính nhất quán

- Mutation nhiều item dùng conditional write hoặc DynamoDB transaction.
- Tích hợp dịch vụ ngoài dùng idempotency, state và retry.
- Không giả lập distributed transaction qua Google, SES, Transcribe hoặc Bedrock.

---

## 17. Observability và cảnh báo

### 17.1. Amazon CloudWatch

CloudWatch thu thập:

- API Gateway access logs;
- Lambda logs;
- Step Functions execution logs;
- AIJob metrics;
- lỗi upload và checksum;
- lỗi reminder;
- lỗi Google integration;
- lỗi Transcribe hoặc Bedrock;
- latency và failure rate.

Các thành phần gửi log/metric:

- API Lambda;
- Reminder Lambda;
- Step Functions;
- AI Worker Lambda.

### 17.2. Amazon SNS

CloudWatch Alarm gửi cảnh báo tới SNS topic. SNS chuyển cảnh báo tới người phụ trách vận hành.

### 17.3. AWS Budgets

AWS Budgets theo dõi chi phí theo môi trường và phát cảnh báo khi vượt ngưỡng đã cấu hình.

---

## 18. CI/CD và Infrastructure as Code

Hạ tầng được quản lý bằng:

- AWS SAM;
- AWS CloudFormation;
- GitHub Actions.

Pipeline khái quát:

```text
Pull request
  → quality gates
  → build / test
  → reviewed change set
  → SAM / CloudFormation deployment
  → smoke test
```

Việc deploy phải tách rõ:

- data stack;
- application stack;
- environment configuration.

Không xóa hoặc thay thế bảng legacy trong cùng một bước triển khai khi chưa hoàn tất audit và backup.

---

## 19. Trình tự triển khai data foundation v2

1. Audit 17 bảng legacy ở chế độ read-only.
2. Backup hoặc export nếu có dữ liệu cần giữ.
3. Deploy data stack v2 để tạo 5 bảng mới.
4. Verify schema, TTL, GSI và tag.
5. Implement repository theo [mô hình DynamoDB v2](../dynamodb-data-model.md).
6. Deploy application stack với cùng `DataTablePrefix`.
7. Thực hiện smoke test core và M5.
8. Xác minh không còn code đọc hoặc ghi bảng legacy.
9. Chỉ sau đó mới xóa bảng cũ.

---

## 20. Các luồng runtime chính

### A. Direct file upload và AI job

```text
Browser
  → API Lambda: presign request
  → S3: direct upload
  → Complete + HeadObject + checksum
  → Step Functions: start AIJob
```

### B. Live transcription

```text
Browser
  → Amazon Transcribe
  → Partial: display only
  → Final segment
  → API Lambda
  → DynamoDB meeting-data
```

### C. Approved source và RAG

```text
S3 normalized source
  → ACL + approved filter
  → Bedrock Knowledge Bases
  → S3 Vectors
  → Grounded answer with citations
  → Preview and confirmation
  → Standard business API
```

### D. Reminder và notification

```text
EventBridge Scheduler
  → Reminder Lambda
  → In-app notification
  → SES optional
  → Email recipient
```

### E. Google integration

```text
API Lambda
  → Google integration adapter
  ├─→ Secret/token reference
  ├─→ Google OAuth / Calendar API
  └─→ Google Meet REST API
```

---

## 21. Nguồn tài liệu liên quan

- [CampusMeet SRS](../CampusMeet-SRS.md)
- [API contract](../api-contract.md)
- [Kiến trúc tổng thể](../architecture.md)
- [Mô hình DynamoDB v2](../dynamodb-data-model.md)
- [Kế hoạch M5 upload, transcript và AI](../ke-hoach-m5-upload-transcript-ai.md)
- [Hướng dẫn triển khai AWS](../huong-dan-trien-khai-aws.md)
- [Sơ đồ AWS Draw.io](./campusmeet-aws-architecture.drawio)

---

## 22. Lưu ý về trạng thái kiến trúc

Sơ đồ và tài liệu này mô tả **kiến trúc mục tiêu**.

Không được suy ra rằng một chức năng đã hoàn thành chỉ vì:

- service đã xuất hiện trong sơ đồ;
- CloudFormation template đã có resource;
- DynamoDB table đã tồn tại;
- API route đã được khai báo.

Trạng thái triển khai thực tế phải được xác nhận bằng:

- code đã hoàn thiện;
- CloudFormation output;
- integration test;
- smoke test;
- CloudWatch logs;
- bằng chứng request đọc/ghi thành công.
