# Hướng dẫn cấu trúc repository CampusMeet

Tài liệu này trả lời “file này dùng để làm gì?” và “tôi nên bắt đầu code ở đâu?”. Trước khi sửa contract hoặc infrastructure, đọc [SRS](CampusMeet-SRS.md), [kiến trúc](architecture.md), [API contract](api-contract.md) và [DynamoDB data model v2](dynamodb-data-model.md).

## 1. Nguyên tắc

- `apps/` chứa frontend/client surfaces.
- `services/` chứa backend/Lambda/worker.
- `packages/shared/` chứa type, enum và DTO dùng chung.
- `infra/` chứa AWS IaC.
- `scripts/` chứa helper audit/verification; script destructive phải explicit và review.
- `docs/` chứa yêu cầu, quyết định kiến trúc và runbook.
- Không đặt credential, OAuth token, presigned URL còn hiệu lực hoặc dữ liệu người dùng thật trong repo.

## 2. Bản đồ thư mục gốc

| Đường dẫn | Vai trò | Owner thường gặp |
| --- | --- | --- |
| `apps/web/` | React/Vite web và route Meet Add-on dùng chung assets | M1/M4/M5 theo feature |
| `services/api/` | API Lambda, application/domain/repository/integration | M1–M5 theo module |
| `services/ai-worker/` | AI worker khi M5 implement | M5 |
| `packages/shared/` | Shared DTO/types/enums/constants | Owner contract + reviewer liên quan |
| `infra/` | Auth stack, data stack, application stack và M5 infra | Infra owner/M5 |
| `scripts/` | Validation, audit, local/bootstrap helpers | Infra owner |
| `docs/` | SRS, architecture, API/data contract, runbook | Tất cả qua PR |
| `.github/` | CI quality gates | Infra/maintainer |

## 3. Frontend — `apps/web/src`

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `app/` | Composition root, providers |
| `components/` | Component dùng chung |
| `config/` | Public build-time config; `VITE_*` không chứa secret |
| `features/` | UI/service theo feature |
| `layouts/` | App shell/sidebar/topbar |
| `lib/` | API client và technical boundary nhỏ |
| `mocks/` | Mock có nhãn rõ, không giả làm production data |
| `routes/` | Route mapping và protection |
| `test/` | Test setup |

Feature ownership:

| Feature | Phạm vi |
| --- | --- |
| `auth` | Cognito sign-up/sign-in/confirm/reset/logout |
| `groups` | Group, membership, invitation |
| `meetings` | Meeting, attendee, agenda, Google status |
| `minutes` | Minutes/decision/action-item UI |
| `tasks` | Task và dashboard |
| `notifications` | In-app notifications |
| `integrations` | Google connect/disconnect/status |
| `attachments` | Upload state và file list |
| `transcripts` | Live status, editor, timestamp/citation UI |
| `ai` | Chat, RAG scope, draft/proposal/citation UI |

Frontend không gọi DynamoDB, S3 credential API, Transcribe hoặc Bedrock bằng credential dài hạn. Luồng dữ liệu nghiệp vụ:

```text
React → API Gateway → Lambda → repository/service
```

## 4. Backend — `services/api/src`

| Đường dẫn | Trách nhiệm | Không đặt ở đây |
| --- | --- | --- |
| `handlers/` | Parse transport/request và trả HTTP response | DynamoDB query trực tiếp, business workflow lớn |
| `application/` | Điều phối use case, transaction boundary, idempotency | API Gateway formatting, SDK chi tiết |
| `domain/` | Rule/validation/ports độc lập AWS | HTTP event, React, credential |
| `repositories/` | DynamoDB adapters theo port | Routing, Google API call |
| `integrations/` | Google, Scheduler, SES, S3, Step Functions adapters | UI, membership rule |
| `middleware/` | Authn/authz/request context/error boundary | Feature workflow |
| `utils/` | Helper nhỏ, logger, response | God helper/business logic |
| `index.ts` | Lambda entry point và route dispatch | CRUD implementation |

Handler → application service → domain port → repository/integration adapter.

Repository không được suy ra quyền chỉ từ `groupId` client gửi. Application/middleware phải dùng Cognito claims và membership lookup.

## 5. DynamoDB repository ownership

Physical tables:

```text
identity
collaboration
meeting-data
task-data
ai-work
```

Chi tiết key/access pattern nằm duy nhất tại [DynamoDB data model v2](dynamodb-data-model.md).

Mapping repository:

| Repository/module | Bảng |
| --- | --- |
| User/profile/integration/notification | `identity` |
| Group/membership/invitation/audit | `collaboration` |
| Meeting/minutes/reminder/attachment/recording/consent/live/transcript | `meeting-data` |
| Task/dashboard task queries | `task-data` |
| AIJob/KnowledgeSource/conversation/citation/proposal/idempotency | `ai-work` |

Không tạo file repository theo quy tắc “mỗi entity phải có bảng riêng”. Có thể tách repository theo domain nhưng nhiều repository dùng cùng physical table/client.

## 6. Shared package

| Đường dẫn | Nội dung |
| --- | --- |
| `types/` | Entity/data shape xuyên frontend/backend |
| `enums/` | State/role/status |
| `dto/` | Request/response contract |
| `constants/` | Constant ổn định dùng chung |
| `index.ts` | Public exports |

Khi thay đổi API contract:

1. sửa shared DTO/type;
2. cập nhật backend;
3. cập nhật frontend;
4. cập nhật `docs/api-contract.md`;
5. cập nhật data model nếu access pattern/key thay đổi;
6. thêm test.

## 7. M5 boundary

M5 source flow:

```text
consent
→ live session hoặc presigned upload
→ final transcript/source
→ AIJob/Step Functions
→ normalize/ingest
→ Bedrock retrieval/generation
→ citation/proposal
```

- Binary/audio: S3 user-content.
- Transcript metadata/segment: `meeting-data`.
- AI control metadata: `ai-work`.
- Normalized source: S3.
- Vector: Knowledge Bases/S3 Vectors.
- Logs: CloudWatch, không chứa content nhạy cảm.

`services/ai-worker/` chỉ được tạo khi contract/provider boundary đã chốt; không để API Lambda giữ request dài chờ STT/ingestion.

## 8. Infrastructure — `infra/`

| File | Vai trò |
| --- | --- |
| `auth-integration.yaml` | Auth integration stack tối thiểu |
| `data-foundation.yaml` | Source of truth cho 5 bảng DynamoDB |
| `template.yaml` | Application target stack, tham chiếu data tables qua prefix |
| `parameters.example.json` | Placeholder an toàn, không chứa secret |

Quy tắc:

- Data stack deploy trước application stack.
- `template.yaml` không tạo lại DynamoDB tables.
- Mọi thay đổi table/GSI/TTL/deletion protection qua IaC và PR.
- Không tạo schema bằng Console.
- Review change set trước execute.
- `DeletionPolicy: Retain` không có nghĩa resource miễn phí sau khi stack bị xóa.

## 9. Scripts

| Script | Tính chất |
| --- | --- |
| `audit-legacy-data-foundation.ps1` | Read-only audit 17 bảng cũ |
| `verify-data-foundation.ps1` | Read-only verify 5 bảng v2 |

Không biến audit script thành delete script. Cleanup legacy phải có danh sách rõ ràng, backup/evidence và reviewer thứ hai.

## 10. Local, test và AWS dev

- Unit test: in-memory repository.
- Local integration: DynamoDB Local cùng 5-table/key contract.
- AWS dev: integration/smoke test chung.
- Mỗi thành viên dùng IAM identity riêng.
- Test data có `createdBy` và prefix ID feature/member.
- Không dùng production data hoặc dữ liệu cá nhân thật.

## 11. Bắt đầu theo vai trò

| Owner | Đọc trước | Thường sửa |
| --- | --- | --- |
| Auth/frontend | README, auth guide, router | `apps/web/src/features/auth`, config/routes |
| Group/member | SRS, API contract, data model collaboration | groups feature, application, collaboration repository |
| Meeting/task | SRS, data model meeting/task | meetings/minutes/tasks handlers/services/repos |
| Google | integration states, API contract | integrations adapter/UI |
| M5 AI | M5 plan, data model meeting/ai-work | attachment/transcript/AI modules, worker, M5 infra |
| Infra | architecture, AWS runbook, data model | `infra/`, `scripts/`, CI |

## 12. File cần phối hợp trước khi sửa

- `infra/*.yaml` và IAM policies.
- `docs/dynamodb-data-model.md`.
- `packages/shared/src/dto/`.
- router chung.
- API error format.
- Cognito config.
- CI workflow.

PR thay đổi contract/infrastructure phải mô tả compatibility, migration, test, cost và rollback/cleanup impact.
