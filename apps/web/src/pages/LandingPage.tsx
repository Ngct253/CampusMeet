import { useEffect, useRef } from 'react';
import { LandingProductPreview } from '../components/LandingProductPreview';
import { useAuth } from '../auth/AuthProvider';
import './landing.css';

const workflow = [
  ['Chuẩn bị nội dung', 'Tập hợp những điểm cần bàn để mọi người có cùng điểm bắt đầu.'],
  ['Chốt quyết định', 'Ghi lại điều đã thống nhất để quyết định không nằm lại trong cuộc gọi.'],
  ['Giao phần việc', 'Biến quyết định thành phần việc có người phụ trách và trạng thái rõ ràng.'],
  ['Theo dõi tiến độ', 'Giữ mạch công việc tiếp tục sau khi cuộc họp đã kết thúc.'],
] as const;

export function LandingPage() {
  const auth = useAuth();
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || !('IntersectionObserver' in window)) return;

    try {
      const items = [...page.querySelectorAll<HTMLElement>('.landing-reveal')];
      page.classList.add('landing-motion-ready');
      const observer = new IntersectionObserver(
        (entries) =>
          entries.forEach(
            (entry) => entry.isIntersecting && entry.target.classList.add('is-visible'),
          ),
        { threshold: 0.12 },
      );
      items.forEach((item) => observer.observe(item));
      return () => observer.disconnect();
    } catch {
      page.classList.remove('landing-motion-ready');
    }
  }, []);

  return (
    <div ref={pageRef} className="landing-page">
      <a className="landing-skip-link" href="#noi-dung-chinh">
        Bỏ qua đến nội dung chính
      </a>
      <header className="landing-header">
        <a className="landing-wordmark" href="#dau-trang" aria-label="CampusMeet, về đầu trang">
          CampusMeet
        </a>
        <nav aria-label="Điều hướng landing">
          <a href="#quy-trinh">Quy trình</a>
          <a href="#xem-truoc">Xem trước</a>
          <a href="#pham-vi">Phạm vi</a>
          {auth.status === 'authenticated' ? <a href={'/app/dashboard'}>Vào ứng dụng</a> : <>
            <a href={'/sign-in'}>Đăng nhập</a>
            <a href={'/sign-up'}>Tạo tài khoản</a>
          </>}
        </nav>
      </header>

      <main id="noi-dung-chinh">
        <section id="dau-trang" className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-container landing-hero__inner">
            <h1 id="landing-title">
              <span>Từ bàn họp đến hành động:</span> Một mạch xuyên suốt.
            </h1>
            <p className="landing-hero__copy">
              CampusMeet kết nối nội dung cần bàn, quyết định đã chốt và phần việc cần theo dõi
              trong một luồng làm việc rõ ràng.
            </p>
            <div className="landing-actions">
              <a className="landing-button landing-button--light" href="#quy-trinh">
                Theo dõi quy trình
              </a>
              <a className="landing-button landing-button--outline" href="#xem-truoc">
                Xem trước giao diện
              </a>
            </div>
            <div className="landing-hero__agenda" aria-hidden="true">
              <span className="landing-hero__agenda-label">Mạch cuộc họp</span>
              <span>Nội dung cần bàn</span>
              <span>Quyết định đã chốt</span>
              <span>Phần việc cần theo dõi</span>
            </div>
          </div>
        </section>
        <section
          id="quy-trinh"
          className="landing-section landing-workflow"
          aria-labelledby="workflow-title"
        >
          <div className="landing-container">
            <div className="landing-intro landing-reveal">
              <p className="landing-kicker">Quy trình</p>
              <h2 id="workflow-title">Mỗi điều được bàn đều có một bước tiếp theo.</h2>
            </div>
            <ol className="landing-workflow__list">
              {workflow.map(([title, copy]) => (
                <li className="landing-workflow__item landing-reveal" key={title}>
                  <span className="landing-workflow__node" aria-hidden="true" />
                  <div>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section
          id="xem-truoc"
          className="landing-section landing-preview-section"
          aria-labelledby="preview-title"
        >
          <div className="landing-container">
            <div className="landing-preview-heading landing-reveal">
              <p className="landing-kicker">Xem trước giao diện</p>
              <h2 id="preview-title">Một không gian làm việc nối tiếp cuộc họp.</h2>
            </div>
            <LandingProductPreview />
          </div>
        </section>

        <section
          id="pham-vi"
          className="landing-section landing-scope"
          aria-labelledby="scope-title"
        >
          <div className="landing-container landing-scope__layout">
            <div className="landing-scope__lead landing-reveal">
              <p className="landing-kicker">Phạm vi sản phẩm</p>
              <h2 id="scope-title">Giữ phần tiếp nối của cuộc họp ở cùng một nơi.</h2>
            </div>
            <div className="landing-scope__columns landing-reveal">
              <div>
                <h3>CampusMeet tập trung vào</h3>
                <p>
                  Nội dung cần bàn, quyết định đã chốt và phần việc cần theo dõi quanh một buổi họp.
                </p>
              </div>
              <div>
                <h3>CampusMeet không thay thế</h3>
                <p>Nền tảng gọi video hoặc công cụ trao đổi quen thuộc đang được sử dụng.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container">
          <span className="landing-wordmark">CampusMeet</span>
          <a className="landing-footer__top-link" href="#dau-trang">
            Lên đầu trang
          </a>
        </div>
      </footer>
    </div>
  );
}
