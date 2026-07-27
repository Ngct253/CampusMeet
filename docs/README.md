# CampusMeet documentation map

## Thứ tự ưu tiên tài liệu

Khi tài liệu có nội dung khác nhau, dùng thứ tự sau:

1. `CampusMeet-SRS.md` quyết định **phạm vi và quy tắc nghiệp vụ logic**.
2. `api-contract.md` quyết định HTTP/shared contract đã được chốt.
3. `dynamodb-data-model.md` quyết định **mô hình vật lý DynamoDB, PK/SK/GSI và mapping repository**.
4. `architecture.md` quyết định service boundary và luồng hệ thống.
5. `ke-hoach-m5-upload-transcript-ai.md` quyết định thứ tự triển khai M5.
6. `huong-dan-trien-khai-aws.md` quyết định thao tác deploy/audit/rollback hiện hành.

## Quyết định thay thế mô hình bảng cũ

Phần danh sách nhiều bảng theo entity trong mục 9.4 của SRS và các nhắc tới 17 bảng trong kế hoạch cũ được xem là **đề xuất lịch sử**, không còn là physical source of truth.

Mô hình hiện hành là 5 bảng:

```text
identity
collaboration
meeting-data
task-data
ai-work
```

Việc thay mô hình vật lý không xóa entity hoặc yêu cầu M1–M5. Group, membership, meeting, minutes, task, attachment, recording, consent, live session, transcript segment, AIJob, KnowledgeSource, conversation, citation và proposal vẫn nằm trong phạm vi.

## Tài liệu nên đọc theo công việc

| Công việc | Tài liệu |
| --- | --- |
| Hiểu sản phẩm/rule | `CampusMeet-SRS.md` |
| Implement endpoint | `api-contract.md` + shared DTO |
| Implement repository | `dynamodb-data-model.md` |
| Deploy lại 5 bảng | `huong-dan-trien-khai-aws.md` |
| Làm upload/live transcript/RAG | `ke-hoach-m5-upload-transcript-ai.md` + data model |
| Thay đổi AWS service/IAM | `architecture.md` + AWS runbook |
| Chia việc nhóm | `ke-hoach-trien-khai-nhom.md` |

Mọi PR thay đổi physical schema phải sửa `dynamodb-data-model.md`, `infra/data-foundation.yaml`, validation script và migration/rollback note trong cùng PR.
