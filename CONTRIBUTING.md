# Đóng góp vào CampusMeet

Đọc [README](README.md), [kế hoạch nhóm](docs/ke-hoach-trien-khai-nhom.md), [hướng dẫn cấu trúc](docs/huong-dan-cau-truc-repository.md) và [hướng dẫn AWS](docs/huong-dan-trien-khai-aws.md) trước khi bắt đầu.

- Không code hoặc push trực tiếp vào `main`; mọi thay đổi đi qua branch, issue và Pull Request có review.
- Không commit `.env`, token, secret, AWS credential hoặc dữ liệu người dùng thật.
- Dùng shared DTO/types thay vì copy contract giữa frontend và backend.
- Không merge khi `lint`, `typecheck`, `test` hoặc `build` lỗi.
- Infrastructure change phải được M5 review; API contract change phải phối hợp các owner liên quan.

Quy ước branch, commit và PR nằm trong [kế hoạch triển khai nhóm](docs/ke-hoach-trien-khai-nhom.md).
