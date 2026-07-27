# Hướng dẫn cấu trúc repository CampusMeet

Đọc cùng [SRS](CampusMeet-SRS.md), [kiến trúc](architecture.md), [API contract](api-contract.md), [kế hoạch nhóm](ke-hoach-trien-khai-nhom.md) và [data foundation](huong-dan-data-foundation.md).

## 1. Thư mục gốc

| Đường dẫn | Vai trò | Không đặt ở đây |
| --- | --- | --- |
| `apps/web/` | React/Vite frontend | Lambda, IAM, server secret |
| `services/api/` | API Lambda, domain, application và adapter | React component |
| `packages/shared/` | Type/enum/DTO dùng chung | AWS SDK, database call, workflow lớn |
| `infra/` | AWS manifest/SAM/CloudFormation source | Credential hoặc code UI |
| `scripts/` | Generate, verify và consistency checks | Password/access key |
| `docs/` | SRS, architecture, API contract và runbook | Log/dữ liệu nhạy cảm |
| `.github/` | CI/PR workflow | Deploy credential |
| `README.md` | Điểm bắt đầu và trạng thái hiện tại | Nhật ký chi tiết lặp lại |

Không commit credential, token, secret hoặc dữ liệu người dùng thật.

## 2. Frontend

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `app/` | Composition root |
| `components/` | Component dùng chung |
| `config/` | Public `VITE_*` config; không chứa secret |
| `features/` | UI/service theo feature |
| `layouts/` | App shell/sidebar/topbar |
| `lib/` | API client và technical boundaries |
| `mocks/` | Mock có nhãn rõ |
| `routes/` | URL → page |
| `test/` | Test setup |

Quy tắc:

- service gọi API client dùng chung;
- không rải `fetch` trong component;
- slice hoàn thành phải bỏ mock tương ứng;
- UI có loading/empty/error/permission state;
- frontend không phải authorization boundary.

## 3. Backend

| Đường dẫn | Trách nhiệm | Không chứa |
| --- | --- | --- |
| `handlers/` | Parse request và format response | DynamoDB query trực tiếp, workflow lớn |
| `application/` | Điều phối use case/transaction/idempotency | HTTP formatting |
| `domain/` | Rule và ports độc lập hạ tầng | AWS SDK/API Gateway event |
| `repositories/` | DynamoDB adapters | Routing/Google calls |
| `integrations/` | Google, Scheduler, SES, STT/Bedrock adapters | UI/membership rule |
| `middleware/` | Auth/context/authorization/error boundary | Feature workflow |
| `utils/` | Helper nhỏ/logger/response | God helper/domain rule |
| `index.ts` | Lambda entry/route dispatch | CRUD implementation |

Luồng chuẩn:

```text
handler
  -> authenticated context
  -> application use case
  -> domain validation/authorization
  -> repository/integration adapter
  -> shared DTO response
```

Data rules:

- table names từ environment;
- AWS SDK chỉ ở repository/infrastructure boundary;
- identity từ verified JWT claims;
- mọi group-scoped operation kiểm tra active membership/role;
- mutation quan trọng dùng conditional expression/idempotency;
- không trả raw DynamoDB item ngoài API contract;
- không thay `NotImplementedError` bằng mock trông như production.

## 4. Shared package

| Đường dẫn | Nội dung |
| --- | --- |
| `types/` | Entity/data shape |
| `enums/` | Status/role |
| `dto/` | API request/response |
| `constants/` | Constant ổn định |
| `index.ts` | Public exports |

Khi đổi API:

1. shared contract;
2. backend;
3. frontend;
4. `docs/api-contract.md`;
5. tests.

## 5. Hạ tầng

| File | Vai trò |
| --- | --- |
| `infra/auth-integration.yaml` | Cognito/API stack nhỏ để kiểm tra auth |
| `infra/data-foundation.spec.json` | Manifest 17 bảng DynamoDB |
| `infra/template.yaml` | Application target stack, không tạo DynamoDB table |
| `infra/parameters.example.json` | Placeholder an toàn |
| `scripts/prepare-data-foundation.mjs` | Sinh generated template + import map |
| `scripts/validate-infra.mjs` | Static consistency checks |
| `scripts/verify-data-foundation.ps1` | Read-only AWS verification |

Ranh giới ownership:

- manifest sở hữu table suffix/key/GSI/TTL;
- generator thêm operational safety như `Retain` và dependency tuần tự;
- generated files nằm trong `.aws-sam/`, không commit;
- application stack chỉ dùng `DataTablePrefix`;
- bảng tạo ngoài CloudFormation cần import trước khi coi IaC là owner;
- primary key change cần migration/recreate, không sửa tùy tiện bằng Console.

## 6. Owner theo feature

| Owner | Phạm vi | Phối hợp |
| --- | --- | --- |
| M1 | Group, membership, invitation | M5 về data/IAM |
| M2 | Meeting lifecycle | M1 membership; M4 Google |
| M3 | Minutes, task, dashboard | M1 assignee; M2 meeting |
| M4 | Google Calendar/Meet, reminder/notification | M2 lifecycle; M5 runtime/secret |
| M5 | Upload, live transcript, RAG/AI, monitoring và data/infra review | M1 ACL; M2 meeting; M3 minutes/task |

M5 review hạ tầng dùng chung nhưng không viết thay feature của M1–M4.

## 7. Files cần phối hợp trước khi sửa

- `infra/data-foundation.spec.json`
- `infra/template.yaml`
- IAM policies
- `packages/shared/src/dto/`
- `apps/web/src/routes/router.tsx`
- API error format
- Cognito configuration
- `.github/workflows/ci.yml`

PR contract/data/IAM phải ghi migration/compatibility, security impact, tests và rollback/cleanup.

## 8. Commands

```powershell
npm run infra:prepare:data
npm run infra:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run format:check
```

AWS read-only verification:

```powershell
npm run aws:verify:data -- -Profile <aws-profile>
```
