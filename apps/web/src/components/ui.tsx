import type { ReactNode } from 'react';

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
export function EmptyState({
  title = 'Chưa có dữ liệu',
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="state">
      <strong>{title}</strong>
      <p>{children ?? 'Dữ liệu mới sẽ xuất hiện tại đây.'}</p>
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="state" role="status">
      Đang tải…
    </div>
  );
}
export function ErrorState() {
  return (
    <div className="state error" role="alert">
      Không thể tải dữ liệu.
    </div>
  );
}
export function StatusBadge({ children }: { children: ReactNode }) {
  return <span className="status-badge">{children}</span>;
}
export function AccessDenied() {
  return <div className="state error">Bạn không có quyền truy cập nội dung này.</div>;
}
export function FeatureComingSoon() {
  return <div className="state">Tính năng đang được chuẩn bị.</div>;
}
