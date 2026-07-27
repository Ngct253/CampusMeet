# Kiến trúc hệ thống CampusMeet

## 1. Tổng quan

CampusMeet là hệ thống hỗ trợ quản lý hoạt động họp và làm việc nhóm dành cho sinh viên, nhóm đồ án và các nhóm dự án.

Hệ thống hướng đến các chức năng chính:

- Đăng ký và đăng nhập tài khoản.
- Quản lý hồ sơ người dùng.
- Tạo và quản lý nhóm.
- Quản lý thành viên và vai trò trong nhóm.
- Lập lịch cuộc họp.
- Quản lý biên bản họp.
- Tạo và phân công nhiệm vụ.
- Theo dõi trạng thái công việc.
- Gửi thông báo và nhắc lịch.
- Đồng bộ lịch họp với Google Calendar.
- Lưu trữ các tệp đính kèm cần thiết.

CampusMeet được thiết kế theo kiến trúc serverless trên AWS nhằm giảm chi phí vận hành, dễ mở rộng và phù hợp với quy mô của một dự án sinh viên.

Tài liệu kiến trúc gồm hai góc nhìn:

1. **Current State** – trạng thái hiện tại của mã nguồn.
2. **Target MVP Architecture** – kiến trúc AWS mục tiêu cho phiên bản MVP.

---

## 2. Trạng thái hiện tại của hệ thống

### 2.1. Frontend

Frontend được xây dựng bằng:

- React 19.
- TypeScript.
- Vite.
- React Router.
- TanStack Query.
- AWS Amplify.

Ứng dụng đã có cấu trúc giao diện, hệ thống định tuyến và các trang chức năng chính.

Các chức năng xác thực hiện đã có:

- Đăng ký tài khoản.
- Xác nhận tài khoản qua email.
- Đăng nhập.
- Đăng xuất.
- Quản lý phiên đăng nhập.
- Bảo vệ các route yêu cầu xác thực.
- Gửi access token trong các yêu cầu gọi API.

Tuy nhiên, một phần dữ liệu nghiệp vụ trên giao diện vẫn đang sử dụng dữ liệu giả lập và chưa kết nối hoàn chỉnh với backend.

### 2.2. Backend

Backend sử dụng:

- Node.js.
- TypeScript.
- AWS Lambda.
- Amazon API Gateway HTTP API.

Backend hiện đã có cấu trúc định tuyến và hai luồng tích hợp cơ bản:

- `GET /health`: kiểm tra trạng thái hoạt động của API.
- `GET /me`: trả về thông tin người dùng đã được xác thực bằng Amazon Cognito.

Các handler nghiệp vụ cho nhóm, cuộc họp, biên bản, công việc và thông báo hiện vẫn đang trong quá trình xây dựng. Một số endpoint mới chỉ có khung xử lý và trả về trạng thái `501 Not Implemented`.

### 2.3. Xác thực và phân quyền

Amazon Cognito User Pool được sử dụng để quản lý danh tính người dùng.

AWS Amplify kết nối frontend với Cognito để thực hiện:

- Đăng ký.
- Xác nhận email.
- Đăng nhập.
- Đăng xuất.
- Làm mới phiên.
- Nhận access token.

API Gateway thực hiện kiểm tra JWT trước khi chuyển yêu cầu đến Lambda.

Tuy nhiên, cơ chế phân quyền nghiệp vụ theo nhóm chưa hoàn thiện. Hệ thống vẫn cần bổ sung kiểm tra:

- Người dùng có thuộc nhóm hay không.
- Người dùng là thành viên hay quản trị viên.
- Người dùng có quyền xem hoặc sửa cuộc họp.
- Người dùng có quyền truy cập biên bản, nhiệm vụ và tệp của nhóm.

Đây là thành phần bảo mật cần được ưu tiên trước khi dữ liệu nghiệp vụ được triển khai đầy đủ.

### 2.4. Dữ liệu

Amazon DynamoDB được lựa chọn làm cơ sở dữ liệu chính trong kiến trúc mục tiêu.

Dữ liệu dự kiến bao gồm:

- User.
- Group.
- GroupMember.
- Meeting.
- MeetingParticipant.
- MeetingMinute.
- ActionItem.
- Task.
- Notification.
- CalendarIntegration.
- FileAttachment.
- AuditLog.

Tuy nhiên, lớp repository thao tác DynamoDB và các access pattern hiện chưa được hoàn thiện.

Trước khi triển khai, nhóm cần xác định rõ các truy vấn chính:

- Lấy thông tin người dùng theo `userId`.
- Liệt kê các nhóm của một người dùng.
- Liệt kê thành viên trong nhóm.
- Kiểm tra vai trò của thành viên.
- Liệt kê cuộc họp của nhóm.
- Liệt kê nhiệm vụ của nhóm.
- Liệt kê nhiệm vụ được giao cho một người dùng.
- Liệt kê thông báo chưa đọc.
- Tìm các lịch nhắc sắp đến.

---

## 3. Kiến trúc AWS mục tiêu

Kiến trúc mục tiêu của CampusMeet sử dụng mô hình serverless và các dịch vụ được quản lý hoàn toàn bởi AWS.

```text
Người dùng
    │
    ▼
Amazon CloudFront
    │
    ▼
Amazon S3 – Frontend
    │
    ├── Amazon Cognito
    │
    ▼
Amazon API Gateway HTTP API
    │
    ▼
AWS Lambda API
    │
    ├── Amazon DynamoDB
    ├── Amazon S3 – User Content
    ├── Amazon EventBridge Scheduler
    ├── AWS Systems Manager Parameter Store
    └── Google Calendar API

Amazon EventBridge Scheduler
    │
    ▼
Reminder Lambda
    │
    ├── Amazon SES
    └── Amazon SQS Dead-Letter Queue

CloudWatch
    │
    ▼
Amazon SNS

GitHub Actions
    │
    ▼
AWS SAM
    │
    ▼
AWS Cloud