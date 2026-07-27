## Mục tiêu

<!-- Vấn đề hoặc outcome mà PR này giải quyết. -->

## Thay đổi chính

<!-- Liệt kê các vertical slice hoặc file quan trọng; tránh kể thay đổi ngoài phạm vi. -->

## Cách kiểm thử

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run format:check`
- [ ] Đã kiểm tra happy path liên quan
- [ ] Đã kiểm tra failure/authorization path quan trọng

## Security và dữ liệu

- [ ] Không có secret, `.env`, token, credential hoặc dữ liệu người dùng thật
- [ ] Backend vẫn kiểm tra authentication, membership/role và input
- [ ] Không log nội dung audio, transcript, prompt hoặc token nhạy cảm
- [ ] Nếu đổi IAM/retention/public access/AI ACL, đã mô tả tác động và rollback/cleanup

## Contract, tài liệu và vận hành

- [ ] Shared DTO/type, frontend, backend và `docs/api-contract.md` đồng bộ hoặc không bị ảnh hưởng
- [ ] README/SRS/architecture/deployment guide đã cập nhật hoặc không bị ảnh hưởng
- [ ] Không thêm dependency, file sinh hoặc abstraction không cần thiết

## Minh chứng và phần còn lại

<!-- Ảnh/video/log an toàn, issue liên quan, lỗi môi trường hoặc rủi ro chưa xử lý. -->
