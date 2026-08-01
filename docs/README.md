# CampusMeet documentation map

## Thứ tự ưu tiên tài liệu

Khi tài liệu có nội dung khác nhau, dùng thứ tự sau:

1. `CampusMeet-SRS.md` quyết định **phạm vi và quy tắc nghiệp vụ logic**.
2. `api-contract.md` quyết định HTTP/shared contract đã được chốt.
3. `dynamodb-data-model.md` quyết định **mô hình vật lý DynamoDB, PK/SK/GSI và mapping repository**.
4. `architecture.md` quyết định service boundary và luồng hệ thống.
5. `thiet-ke-ky-thuat-upload-live-transcript-ai.md` mô tả contract, luồng dữ liệu, bảo mật và kiểm thử kỹ thuật AI.
6. `huong-dan-trien-khai-aws.md` quyết định thao tác deploy/verify/rollback hiện hành.

## Mô hình dữ liệu hiện hành

CampusMeet dùng 5 bảng DynamoDB:

```text
identity
collaboration
meeting-data
task-data
ai-work
```

Mô hình 5 bảng vẫn bao phủ Group, membership, meeting, minutes, task, attachment, recording, consent, live session, transcript segment, AIJob, KnowledgeSource, conversation, citation và proposal.

## Tài liệu nên đọc theo công việc

| Công việc                      | Tài liệu                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Hiểu sản phẩm/rule             | `CampusMeet-SRS.md`                                                                                                       |
| Implement endpoint             | `api-contract.md` + shared DTO                                                                                            |
| Implement repository           | `dynamodb-data-model.md`                                                                                                  |
| Kiểm tra hoặc cập nhật 5 bảng  | `huong-dan-trien-khai-aws.md`                                                                                             |
| Làm upload/live transcript/RAG | `ke-hoach-trien-khai-nhom.md` để xem phân công; `thiet-ke-ky-thuat-upload-live-transcript-ai.md` để xem thiết kế kỹ thuật |
| Thay đổi AWS service/IAM       | `architecture.md` + AWS runbook                                                                                           |
| Chia việc nhóm                 | `ke-hoach-trien-khai-nhom.md`                                                                                             |

Mọi PR thay đổi physical schema phải sửa `dynamodb-data-model.md`, `infra/data-foundation.yaml`, validation script và migration/rollback note trong cùng PR.
