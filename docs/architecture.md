# Kiến trúc CampusMeet

## Trạng thái hiện tại

Repository mới có application shell, mock data, shared contracts, Lambda handler skeleton và AWS SAM skeleton. Chỉ `GET /health` có xử lý thật ở mức tối thiểu; API nghiệp vụ, Cognito, DynamoDB, Google, reminder và email chưa được kết nối. Chưa có AWS resource nào được deploy.

## Kiến trúc mục tiêu đã chốt

```mermaid
flowchart LR
  U["User / Browser"]
  G["Google OAuth + Calendar + Meet REST\nExternal"]
  MA["Google Meet\nAdd-on side panel host"]
  DG["Deepgram\nOptional STT adapter"]
  E["Email recipient"]
  CF["CloudFront\nEdge / global"]
  subgraph AWS["AWS Cloud"]
    subgraph R["AWS Region"]
      S3["S3 static private bucket"]
      S3C["S3 user-content private bucket"]
      COG["Cognito User Pool"]
      APIG["API Gateway HTTP API"]
      API["API Lambda"]
      PORT["Repository interfaces"]
      DDB["DynamoDB"]
      SCH["EventBridge Scheduler"]
      REM["Reminder Lambda"]
      SFN["Step Functions\nAI jobs"]
      AI["AI Worker Lambda"]
      TR["Amazon Transcribe\nmultilingual / vi-VN priority"]
      BR["Amazon Bedrock"]
      KB["Bedrock Knowledge Bases"]
      VEC["S3 Vectors"]
      SES["SES"]
      CW["CloudWatch Logs / Metrics / Alarm"]
      SNS["SNS topic"]
    end
  end
  U -->|"1. tải frontend"| CF --> S3
  U -->|"mở cuộc họp + side panel"| MA
  MA -->|"tải route add-on HTTPS"| CF
  U -->|"2. gọi API"| APIG -->|"3. invoke"| API
  U -. "xác thực mục tiêu" .-> COG
  API -->|"4. gọi repository"| PORT --> DDB
  API -. "5. Calendar / Meet artifacts" .-> G
  SCH -->|"6. invoke"| REM
  REM -->|"7a. tạo notification"| DDB
  REM -. "7b. thử gửi email" .-> SES --> E
  API -->|"8. presigned URL"| S3C
  U -->|"9. upload trực tiếp"| S3C
  S3C -->|"10. tạo AI job"| SFN
  SFN -->|"11a. STT mặc định"| TR
  SFN -. "11b. adapter tùy chọn" .-> DG
  SFN -->|"12. parse / generation"| AI --> BR
  BR -->|"13. grounded retrieval"| KB --> VEC
  AI -->|"14. transcript / job / citation"| DDB
  API --> CW
  REM --> CW
  SFN --> CW
  AI --> CW
  CW -->|"15. alarm"| SNS
```

Luồng chính:

1. Browser tải static frontend qua CloudFront và S3 private.
2. Browser gọi API Gateway bằng token Cognito ở giai đoạn triển khai thật.
3. API Gateway gọi API Lambda.
4. Lambda gọi repository interface; adapter DynamoDB thật chưa tồn tại.
5. Google Calendar dùng để tạo/sửa/hủy event và Meet link. Meet REST API là adapter hậu họp để lấy conference artifacts khi gói/quyền thực tế cho phép; nếu không có thì UI dùng upload/recording fallback.
6. EventBridge Scheduler gọi Reminder Lambda theo one-time schedule.
7. Reminder tạo in-app notification trước, sau đó mới thử gửi email SES.
8. API chỉ cấp presigned URL sau kiểm tra quyền và metadata.
9. Browser upload tài liệu/audio trực tiếp vào S3 user-content; file lớn không đi qua API Gateway/Lambda.
10. Upload hợp lệ tạo `AIJob`; Step Functions điều phối parse, STT, ingestion và generation bất đồng bộ.
11. `SpeechToTextProvider` xử lý ngôn ngữ đang nói; tiếng Việt là ngôn ngữ benchmark ưu tiên. Amazon Transcribe là adapter AWS mặc định, provider khác có thể thay thế theo cấu hình.
12. AI Worker gọi Amazon Bedrock. Model ID là cấu hình, không hard-code trong domain.
13. RAG dùng Bedrock Knowledge Bases + S3 Vectors với ba scope `CURRENT_MEETING`, `SELECTED_MEETINGS`, `WHOLE_GROUP`; mỗi query chỉ có một `groupId` và phải filter group/meeting-set/ACL/source status trước retrieval.
14. Transcript segment, job status, conversation metadata, task/tool proposal và group progress snapshot nằm trong DynamoDB; nội dung media nằm trong S3 private.
15. CloudWatch theo dõi core và AI pipeline; Alarm gửi cảnh báo qua SNS.
16. CampusMeet web vẫn là sản phẩm chính. Google Meet có thể tải một route side panel tối giản từ cùng CloudFront origin; route này lấy meeting context bằng Meet Add-ons SDK và gọi chung API/authorization, không có backend riêng.

CloudFront là edge/global service; các AWS service còn lại được đặt trong Region. MVP không đặt Lambda trong VPC và không dùng NAT Gateway để tránh chi phí, độ trễ và vận hành không cần thiết.

Sơ đồ là **target architecture**, không phải bằng chứng đã deploy hoặc đã tích hợp Google/AWS.

## Quyết định AI và Google đã chốt

- Không xây video call/WebRTC; Calendar API vẫn là luồng tạo event và Meet link.
- Meet REST API chỉ đồng bộ participants/recording/transcript khi artifact tồn tại và OAuth scope cho phép. MVP dùng nút đồng bộ hoặc polling AWS có giới hạn; không dùng Google Workspace Events vì notification endpoint yêu cầu Google Cloud Pub/Sub.
- Mỗi phiên họp phải khởi tạo live transcription chạy nền sau user gesture/consent và giữ hoạt động trong suốt phiên. Voice record/live transcript là nguồn duy nhất của nội dung phát biểu; agenda hoặc participant metadata không được dùng để suy đoán nội dung. Khi stream lỗi, các chức năng phụ thuộc nội dung bị khóa nhưng quản lý cuộc họp cơ bản vẫn hoạt động.
- STT giữ ngôn ngữ đang nói, ưu tiên chất lượng tiếng Việt và chỉ gắn `Speaker 1/2/...` ẩn danh; không có speaker-to-user mapping hoặc voice identity.
- Tài liệu có thể upload trước/trong/sau meeting. Chatbot current-meeting kết hợp document retrieval với segment final đọc trực tiếp từ transcript store; approved transcript/minutes mới ingest vào Knowledge Base cho selected/whole-group. Live source luôn được đánh dấu chưa duyệt.
- Biên bản AI ghi diễn biến/quyết định/action item đã được nêu. Task proposal có citation và chỉ gọi Task API sau preview, xác nhận, authorization và idempotency.
- RAG hỗ trợ current/selected/whole-group trong tối đa một group; không cross-group, reranking hoặc implicit filter trong MVP. Khi thiếu nguồn, trợ lý yêu cầu bổ sung hoặc báo không đủ căn cứ.
- Phân tích tiến độ chỉ diễn giải snapshot task/meeting cấp nhóm do backend tính; không đánh giá cá nhân và không gây mutation.
- CampusMeet không chuyển toàn bộ thành add-on và không nhúng giao diện Meet vào iframe thông thường. Meet Add-on chỉ là client surface tối giản trong side panel/main stage, dùng chung web assets, API, dữ liệu và authorization.
- MVP dùng deployment add-on chưa công bố để thử nghiệm. Private Marketplace chỉ dành cho cùng Google Workspace organization; public Marketplace cần Google review/OAuth verification phù hợp và không được làm chậm Core MVP.
- Panel trong CampusMeet web là fallback bắt buộc khi add-on chưa cài/bị quản trị viên chặn; Document PiP chỉ là progressive enhancement bổ sung.

## Nguyên tắc dữ liệu và quyền

- Timestamp lưu UTC; frontend hiển thị theo timezone người dùng.
- Một nhóm luôn có ít nhất một Group Admin.
- Chỉ active member được làm attendee hoặc assignee.
- Mọi thao tác group-scoped phải kiểm tra membership theo `groupId` sau khi xác thực danh tính.
- Một meeting có một organizer; Meet link chỉ hiện khi integration status là `READY`.
- Task overdue là dữ liệu tính toán, không phải một trạng thái task mới.
- `meetingStatus` và `googleSyncStatus` là hai state machine độc lập.
- Tài liệu, transcript, biên bản và vector đều mang `groupId`, `meetingId`, source status và ACL; filter group/meeting-set/quyền xảy ra trước retrieval.
- Audio, transcript và AI conversation có consent/retention; nội dung nhạy cảm không được ghi vào application log.
- Task/tool proposal không có quyền riêng; nó chỉ được thực thi bằng quyền hiện tại của người dùng đã xác nhận.

Các quyết định cần nhóm chốt trước triển khai nằm trong [kế hoạch nhóm](ke-hoach-trien-khai-nhom.md).
