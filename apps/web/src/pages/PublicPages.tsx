import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <main className="public-page">
      <p className="eyebrow">CampusMeet</p>
      <h1>Cuộc họp rõ ràng, công việc không thất lạc.</h1>
      <p>Khung ứng dụng quản lý quy trình trước, trong và sau cuộc họp nhóm.</p>
      <div className="actions">
        <Link className="button" to="/sign-in">
          Đăng nhập
        </Link>
        <Link to="/sign-up">Tạo tài khoản</Link>
      </div>
      <small>Scaffold only — chưa có xác thực hoặc tích hợp thật.</small>
    </main>
  );
}
export function SignInPage() {
  return (
    <main className="public-page">
      <h1>Đăng nhập</h1>
      <p>Form Cognito sẽ được M1/M3 kết nối sau.</p>
      <button disabled>Đăng nhập (chưa khả dụng)</button>
    </main>
  );
}
export function SignUpPage() {
  return (
    <main className="public-page">
      <h1>Tạo tài khoản</h1>
      <p>Đăng ký hiện là giao diện placeholder, không gửi dữ liệu.</p>
      <button disabled>Tạo tài khoản (chưa khả dụng)</button>
    </main>
  );
}
