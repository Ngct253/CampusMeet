# Hướng dẫn cấu trúc repository CampusMeet

Tài liệu này trả lời hai câu hỏi: “file này dùng để làm gì?” và “tôi nên bắt đầu code ở đâu?”. Trước khi sửa contract hoặc infrastructure, đọc thêm [SRS](CampusMeet-SRS.md), [kiến trúc](architecture.md), [API contract](api-contract.md) và [data foundation](huong-dan-data-foundation.md).

## 1. Nguyên tắc đọc repository

- `apps/` chứa ứng dụng frontend.
- `services/` chứa backend/Lambda.
- `packages/shared/` chứa type, enum, DTO và constant dùng chung.
- `infra/` chứa hạ tầng AWS bằng code.
- `scripts/` chứa script kiểm tra/vận hành có thể review.
- `docs/` chứa yêu cầu và quy ước làm việc.
- Không đặt business logic lớn trong `packages/shared/`; logic thuộc domain/application của backend.
- Không đặt AWS credential, Google token, OAuth secret hoặc dữ liệu người dùng thật ở bất kỳ folder nào.

## 2. Bản đồ thư mục gốc

| Đường dẫn | Dùng để làm gì | Ai thường sửa | Không nên đặt ở đây |
| --- | --- | --- | --- |
| `apps/` | Các ứng dụng giao diện | M1 và owner feature | Lambda handler, IAM policy |
| `services/` | API/Lambda và xử lý server | M2–M5 theo module | React component, browser secret |
| `packages/` | Contract TypeScript dùng chung | M3 phối hợp mọi owner | Database call, UI, business workflow lớn |
| `infra/` | AWS SAM/CloudFormation source of truth | M5 | Code React hoặc credential thật |
| `scripts/` | Verification/acceptance/maintenance script | M5 và owner liên quan | Password, access key, output nhạy cảm |
| `docs/` | SRS, kiến trúc, contract và hướng dẫn nhóm | Tất cả; owner liên quan review | File tạm, báo cáo lặp ý |
| `.github/` | CI quality gates | M5 | AWS key hoặc deploy chưa review |
| `package.json` | npm workspaces và root scripts | M1/M3/M5 khi cần | Deploy production tự động chưa duyệt |
| `package-lock.json` | Phiên bản dependency tái lập | npm tạo; commit cùng dependency change | Chỉnh tay |
| `tsconfig.base.json` | TypeScript strict defaults | M1/M3 | Config riêng không áp dụng toàn repo |
| `eslint.config.js` | Quy tắc lint chung | M1/M3 | Rule chỉ để che lỗi module cụ thể |
| `README.md` | Điểm bắt đầu duy nhất | Tất cả qua PR | Chi tiết module dài hoặc nhật ký tạm |
| `CONTRIBUTING.md` | Quy tắc đóng góp ngắn | Tất cả qua PR | Lặp toàn bộ kế hoạch 8 tuần |

## 3. Frontend: `apps/web/src`

| Đường dẫn | Vai trò |
| --- | --- |
| `app/` | Composition root: QueryClient và RouterProvider |
| `components/` | Component dùng chung như page header, states, badge và page wrapper |
| `config/` | Public build-time configuration; `VITE_*` tuyệt đối không chứa secret |
| `features/` | Code chia theo feature/ownership để giảm conflict |
| `layouts/` | AppShell, sidebar, topbar và bố cục dùng chung |
| `lib/` | Boundary kỹ thuật như `apiClient`, không chứa feature workflow |
| `mocks/` | Mock data có nhãn rõ để render scaffold |
| `pages/` | Public pages và NotFound; protected feature pages không đặt ở đây |
| `routes/` | Router chung và mapping URL thành page |
| `styles/` | Global CSS hiện tại |
| `test/` | Test setup dùng chung |
| `main.tsx` | Browser entry point, mount React app |

### Các feature hiện có

| Feature | Mục đích và file nên đặt | Owner chính | Không đặt ở đây |
| --- | --- | --- | --- |
| `auth` | Sign-in/sign-up state, Cognito client boundary và route guard | M1 phối hợp M5 | Cognito IAM/config hoặc token server-side |
| `dashboard` | Dashboard pages, query/service và presentation state | M1 | Group/meeting business rules |
| `groups` | Group, membership, invitation pages/services | M2 | Dashboard tổng hợp hoặc Google OAuth |
| `meetings` | Meeting pages/services và UI trạng thái integration | M3 phối hợp M4 | Google token hoặc Calendar SDK call trực tiếp |
| `minutes` | Minutes, decisions, action items UI/service | M3 | Repository/DynamoDB call |
| `tasks` | Task pages/services và status UI | M3 | Quy tắc quyền chỉ chạy ở client |
| `notifications` | In-app notification pages/services | M3 phối hợp M5 | SES send call từ browser |
| `integrations` | UI connect/disconnect và trạng thái Google | M4 | OAuth secret/access token |
| `settings` | Profile, timezone và integration settings page | M1 phối hợp M4 | Authentication source of truth |

Quy tắc frontend:

- Page theo feature đặt trong `features/<feature>/pages/`.
- Feature service hiện trả mock phải giữ `isMock: true` hoặc nhãn mock tương đương.
- Component dùng cho từ hai feature trở lên mới chuyển vào `components/`.
- Frontend không tự quyết định authorization; backend phải kiểm tra lại membership/role.

## 4. Backend: `services/api/src`

| Đường dẫn | Trách nhiệm | Không nên chứa |
| --- | --- | --- |
| `handlers/` | Nhận API Gateway event, parse transport input và trả HTTP response | Business logic lớn, query DynamoDB trực tiếp |
| `application/` | Điều phối use case sau validation/auth | AWS SDK details hoặc HTTP response formatting |
| `domain/` | Rule, validation và port/interface độc lập hạ tầng | API Gateway event, React hoặc AWS credential |
| `repositories/` | Adapter đọc/ghi DynamoDB theo interface domain | HTTP routing hoặc Google call |
| `integrations/` | Adapter Google Calendar, EventBridge Scheduler, SES | UI hoặc database ownership rule |
| `middleware/` | Authentication, authorization, request context và lỗi chung | Feature-specific workflow |
| `utils/` | Logger, request ID, response/error helpers nhỏ | Domain logic hoặc “god helper” |
| `index.ts` | Lambda entry point và route dispatch | CRUD implementation |

Handler chỉ nhận request/trả response. Domain chứa rule/validation. Repository là lớp đọc/ghi DynamoDB. Integration là lớp gọi hệ thống ngoài. Middleware chịu trách nhiệm authentication, authorization theo `groupId`, request ID và error boundary.

Shared DTO phải import từ `@campusmeet/shared`, không copy lại trong backend. Adapter đang ném `NotImplementedError` có chủ đích; không thay bằng dữ liệu giả trông như production.

Khi triển khai data layer:

- tên bảng nhận từ environment do SAM template truyền vào;
- AWS SDK chỉ xuất hiện trong repository/infrastructure boundary;
- handler không tự query DynamoDB;
- identity lấy từ JWT claims đã xác minh;
- group-scoped use case phải kiểm tra Memberships trước mutation/read;
- conditional write/idempotency nằm ở application/repository boundary;
- repository test phải có cross-group denial path.

## 5. Shared package: `packages/shared/src`

| Đường dẫn | Nội dung |
| --- | --- |
| `types/` | Entity/data shape dùng xuyên frontend/backend |
| `enums/` | Trạng thái và role thống nhất |
| `dto/` | Request/response contract qua API boundary |
| `constants/` | Constant thật sự dùng chung, ổn định |
| `index.ts` | Public exports của package |

Không đặt repository, AWS SDK, React component hoặc workflow nghiệp vụ trong shared package.

Khi thay đổi API request/response:

1. Sửa DTO trong shared.
2. Cập nhật backend.
3. Cập nhật frontend.
4. Cập nhật `docs/api-contract.md`.
5. Thêm hoặc sửa test.

## 6. Hạ tầng: `infra/`

| File | Vai trò |
| --- | --- |
| `auth-integration.yaml` | Stack Cognito/API tối thiểu để xác minh auth |
| `data-foundation.yaml` | Source of truth cho 17 bảng DynamoDB |
| `template.yaml` | Application stack mục tiêu, dùng bảng qua `DataTablePrefix` |
| `parameters.example.json` | Placeholder an toàn; không chứa secret thật |

Quy tắc ownership:

- `data-foundation.yaml` sở hữu table names, keys, GSIs, TTL, PITR/deletion parameters và outputs.
- `template.yaml` không tạo DynamoDB table.
- Application stack chỉ nhận prefix và cấp Lambda IAM đúng table/index.
- Bảng tạo ngoài CloudFormation chưa tự trở thành IaC-managed resource.
- Không deploy data foundation vào tên bảng đã tồn tại trước khi verify/import.
- Không sửa key schema bằng thao tác tùy tiện; primary key không thể update in-place.
- Không tạo resource trùng bằng Console sau khi IaC đã là owner.

IAM policy có thể nằm cạnh execution role trong application template để review. Developer policy được ghi trong data-foundation runbook, không gắn trực tiếp vào application execution role.

## 7. Scripts

| File | Vai trò |
| --- | --- |
| `scripts/verify-data-foundation.ps1` | Kiểm tra account, đủ 17 bảng, status, billing, keys và GSIs |

Script verification:

- không tạo/sửa/xóa tài nguyên;
- phải fail rõ khi account/Region sai;
- không ghi credential/token;
- output dùng làm evidence PR nhưng cần che identifier không cần thiết;
- `-SkipSchema` chỉ dùng điều tra, không phải acceptance cuối.

## 8. Tôi phụ trách phần này, tôi bắt đầu ở đâu?

| Tôi phụ trách | Folder/file cần đọc trước | Folder/file thường sửa | Cần phối hợp với |
| --- | --- | --- | --- |
| M1 — frontend foundation/dashboard | README, router, AppShell, dashboard pages | `apps/web/src/app`, `layouts`, `components`, `features/dashboard` | M2/M3 về API; M5 về auth/deploy config |
| M2 — group/membership/invitation | SRS, shared types/DTO, API contract, data foundation | `features/groups`, group handlers/application/repository | M1 về UI; M3 về auth boundary; M5 về tables |
| M3 — meeting/minutes/task/domain/API | SRS rules, ports, shared DTO, data foundation | meeting/minutes/task features và `services/api/src` | M2 về membership; M4/M5 về adapters |
| M4 — Google OAuth/Calendar/Meet | SRS integration states, integration port, meeting UI | `features/integrations`, `services/api/src/integrations` | M3 về lifecycle; M5 về secret reference |
| M5 — SAM/deployment/reminder/monitoring | architecture, AWS guide, data foundation | `infra`, `scripts`, reminder/integration, `.github` | M1–M4 về runtime/config/metrics |

Ownership là trách nhiệm về outcome, không có nghĩa owner tự viết toàn bộ code. Integration phải đi qua shared contract và Pull Request.

## 9. File không nên tự sửa

- `infra/data-foundation.yaml`, `infra/template.yaml` và IAM roles/policies.
- `packages/shared/src/dto/`.
- `apps/web/src/routes/router.tsx`.
- API error format trong `services/api/src/utils/response.ts`.
- Cognito configuration.
- `.github/workflows/ci.yml`.

Chỉ sửa khi đã thông báo owner liên quan và có issue/PR mô tả ảnh hưởng. Với contract hoặc infrastructure, PR phải chỉ rõ migration/compatibility, test và rollback/cleanup impact.
