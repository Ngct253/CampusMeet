# Hướng dẫn cấu trúc repository CampusMeet

Tài liệu này trả lời: “file này dùng để làm gì?” và “owner feature nên bắt đầu ở đâu?”. Trước khi sửa contract hoặc infrastructure, đọc [SRS](CampusMeet-SRS.md), [kiến trúc](architecture.md), [API contract](api-contract.md), [kế hoạch nhóm](ke-hoach-trien-khai-nhom.md) và [data foundation](huong-dan-data-foundation.md).

## 1. Nguyên tắc

- `apps/` chứa frontend.
- `services/` chứa backend/Lambda.
- `packages/shared/` chứa type, enum và DTO dùng chung.
- `infra/` chứa AWS IaC.
- `scripts/` chứa verification/maintenance script có thể review.
- `docs/` chứa yêu cầu, kiến trúc, contract và runbook.
- Business rule thuộc domain/application, không đặt trong UI hoặc shared package.
- Không commit credential, token, secret hoặc dữ liệu người dùng thật.

## 2. Thư mục gốc

| Đường dẫn | Vai trò | Không đặt ở đây |
| --- | --- | --- |
| `apps/web/` | React/Vite application | Lambda/IAM/secret server-side |
| `services/api/` | API Lambda, domain, application và adapter | React component |
| `packages/shared/` | Contract TypeScript xuyên frontend/backend | AWS SDK, database call, workflow lớn |
| `infra/` | CloudFormation/SAM source of truth | Credential hoặc code UI |
| `scripts/` | Script verify/acceptance/maintenance | Password/access key |
| `docs/` | SRS, architecture, API contract và runbook | Generated artifact hoặc log nhạy cảm |
| `.github/` | CI và PR template | Deploy credential |
| `README.md` | Điểm bắt đầu và trạng thái hiện tại | Nhật ký dài hoặc chi tiết module lặp lại |

## 3. Frontend: `apps/web/src`

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `app/` | Composition root |
| `components/` | Component dùng chung từ hai feature trở lên |
| `config/` | Public build-time config; `VITE_*` không chứa secret |
| `features/` | UI/service theo miền nghiệp vụ |
| `layouts/` | App shell/sidebar/topbar |
| `lib/` | Boundary kỹ thuật như API client |
| `mocks/` | Mock có nhãn rõ |
| `pages/` | Public page và NotFound |
| `routes/` | URL → page |
| `test/` | Test setup dùng chung |

### Owner theo feature

| Feature | Owner chính | Phối hợp |
| --- | --- | --- |
| `auth` | Nền tảng dùng chung đã có | M5 review Cognito/runtime |
| `groups` | M1 | M5 về data/IAM |
| `meetings` | M2 | M1 membership; M4 Google |
| `minutes` | M3 | M2 meeting |
| `tasks` | M3 | M1 assignee/member |
| `dashboard` | M3 | M1/M2 về source data |
| `notifications` | M4 | M5 Scheduler/SES/runtime |
| `integrations` | M4 | M2 lifecycle; M5 secret/runtime |
| upload/recording/transcript/AI UI | M5 | M1 ACL; M2/M3 source/contract |
| `settings` | owner của setting liên quan | Auth/profile M1; Google M4 |

Quy tắc frontend:

- Page theo feature đặt trong `features/<feature>/pages/`.
- Service gọi API client dùng chung, không rải `fetch` trong component.
- Mock phải có nhãn rõ và bị loại khỏi slice đã hoàn thành.
- UI hiển thị loading/empty/error/permission state.
- Client không quyết định authorization.

## 4. Backend: `services/api/src`

| Đường dẫn | Trách nhiệm | Không nên chứa |
| --- | --- | --- |
| `handlers/` | Parse transport input và format HTTP response | DynamoDB query trực tiếp, workflow lớn |
| `application/` | Điều phối use case, transaction/idempotency | API Gateway response formatting |
| `domain/` | Rule và port/interface độc lập hạ tầng | AWS SDK hoặc React |
| `repositories/` | DynamoDB adapter triển khai domain ports | Route dispatch hoặc Google call |
| `integrations/` | Google, Scheduler, SES, AI provider adapter | UI hoặc membership rule |
| `middleware/` | Auth, authorization context, request ID, error boundary | Feature workflow |
| `utils/` | Helper nhỏ, logger và response/error utilities | God helper hoặc domain rule |
| `index.ts` | Lambda entry point/route dispatch | CRUD implementation |

### Luồng chuẩn

```text
handler
  -> authenticated request context
  -> application use case
  -> domain validation/authorization port
  -> repository/integration adapter
  -> shared response DTO
```

### Quy tắc data layer

- Tên bảng nhận từ environment do `infra/template.yaml` truyền vào.
- AWS SDK chỉ xuất hiện ở infrastructure/repository boundary.
- Identity lấy từ JWT claims đã xác minh; không tin `userId` frontend gửi.
- Mọi dữ liệu group-scoped kiểm tra active Membership và role.
- Mutation quan trọng dùng conditional expression/idempotency.
- Không trả raw DynamoDB item ngoài API contract.
- Không thay `NotImplementedError` bằng mock trông như production.

## 5. Shared package

| Đường dẫn | Nội dung |
| --- | --- |
| `types/` | Entity/data shape dùng chung |
| `enums/` | Status và role thống nhất |
| `dto/` | Request/response contract |
| `constants/` | Constant ổn định, thật sự dùng chung |
| `index.ts` | Public exports |

Khi đổi API contract:

1. cập nhật shared DTO/type;
2. cập nhật backend;
3. cập nhật frontend;
4. cập nhật `docs/api-contract.md`;
5. thêm/sửa test.

## 6. Hạ tầng: `infra/`

| File | Vai trò |
| --- | --- |
| `auth-integration.yaml` | Cognito/API/Lambda tối thiểu để kiểm tra auth |
| `data-foundation.yaml` | Source of truth cho 17 bảng DynamoDB |
| `template.yaml` | Application stack dùng `DataTablePrefix`, không tạo table |
| `parameters.example.json` | Placeholder an toàn |

Ranh giới ownership:

- Data foundation sở hữu table name, key, GSI, TTL, SSE, PITR/deletion parameters, tags và outputs.
- Application template truyền đủ 17 table name vào Lambda và cấp IAM đúng prefix/index.
- Bảng tạo ngoài CloudFormation chưa tự trở thành IaC-managed resource.
- Không deploy data template vào tên bảng đã tồn tại trước verify/import.
- Không sửa primary key bằng thao tác Console; thay đổi key cần migration/recreate có kế hoạch.

## 7. Scripts

| File | Vai trò |
| --- | --- |
| `scripts/verify-data-foundation.ps1` | Kiểm tra account, Region, 17 bảng, status, billing, keys và GSIs |

Script verification phải read-only, fail rõ khi account/Region sai và không ghi credential. `-SkipSchema` chỉ dùng điều tra inventory, không phải acceptance cuối.

## 8. Bắt đầu theo owner

| Owner | Đọc trước | Thường sửa |
| --- | --- | --- |
| M1 — Group/Membership/Invitation | SRS group rules, shared DTO, data guide | `features/groups`, group handler/application/repository/tests |
| M2 — Meeting | Meeting lifecycle, membership contract | `features/meetings`, meeting handler/application/repository/tests |
| M3 — Minutes/Task/Dashboard | Minutes/task rules, meeting contract | feature tương ứng, application/repository/tests |
| M4 — Google/Reminder/Notification | Google states, meeting lifecycle, AWS runbook | integrations, notification/reminder code và UI |
| M5 — Data/Upload/AI/Operations | Architecture, data guide, AWS runbook | `infra`, `scripts`, upload/transcript/AI adapters, monitoring |

M5 review hạ tầng dùng chung nhưng không viết thay toàn bộ feature. Owner feature chịu trách nhiệm UI, API, data, validation, tests và docs của outcome mình.

## 9. File cần phối hợp trước khi sửa

- `infra/data-foundation.yaml`
- `infra/template.yaml`
- IAM roles/policies
- `packages/shared/src/dto/`
- `apps/web/src/routes/router.tsx`
- API error format trong `services/api/src/utils/response.ts`
- Cognito configuration
- `.github/workflows/ci.yml`

PR thay đổi contract/data/IAM phải ghi migration/compatibility, security impact, test và rollback/cleanup.
