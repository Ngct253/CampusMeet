export function LandingProductPreview() {
  return (
    <figure className="landing-preview" aria-labelledby="preview-caption">
      <div className="landing-preview__window">
        <div className="landing-preview__bar">
          <span className="landing-preview__context">CampusMeet</span>
          <span className="landing-preview__context">Luồng công việc</span>
        </div>
        <div className="landing-preview__body">
          <div className="landing-preview__thread" aria-hidden="true" />
          <div className="landing-preview__content">
            <section className="landing-preview__row">
              <div className="landing-preview__row-heading">
                <p className="landing-preview__label">Nội dung cần bàn</p>
                <span className="landing-preview__state">Đang chuẩn bị</span>
              </div>
              <p>Những điểm cần thống nhất trước khi bắt đầu cuộc họp.</p>
            </section>
            <section className="landing-preview__row">
              <div className="landing-preview__row-heading">
                <p className="landing-preview__label">Quyết định đã chốt</p>
                <span className="landing-preview__state landing-preview__state--decision">
                  Đã chốt
                </span>
              </div>
              <p>Điều đã thống nhất được giữ lại để làm căn cứ cho bước tiếp theo.</p>
            </section>
            <section className="landing-preview__row">
              <div className="landing-preview__row-heading">
                <p className="landing-preview__label">Phần việc có người phụ trách</p>
                <span className="landing-preview__state landing-preview__state--task">
                  Cần thực hiện
                </span>
              </div>
              <p>Việc cần làm tiếp theo được đặt cạnh quyết định liên quan.</p>
            </section>
            <section className="landing-preview__row">
              <div className="landing-preview__row-heading">
                <p className="landing-preview__label">Tiến độ được theo dõi</p>
                <span className="landing-preview__state landing-preview__state--progress">
                  Đang theo dõi
                </span>
              </div>
              <p>Trạng thái của phần việc được nhìn thấy trong cùng một luồng.</p>
            </section>
          </div>
        </div>
      </div>
      <figcaption id="preview-caption">
        <strong>Minh họa giao diện CampusMeet.</strong> Nội dung mô phỏng luồng sử dụng, không phải
        dữ liệu thật.
      </figcaption>
    </figure>
  );
}
