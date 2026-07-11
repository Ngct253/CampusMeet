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
