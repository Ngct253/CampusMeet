import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from './ui';

export function FeaturePage({
  title,
  description,
  backTo,
  backLabel = 'Quay lại',
  children,
}: {
  title: string;
  description: string;
  backTo?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  return (
    <section className="feature-page">
      <div className="feature-page-heading">
        <PageHeader title={title} description={description} />
        {backTo && (
          <Link className="page-back-link" to={backTo}>
            {backLabel}
          </Link>
        )}
      </div>
      {children ?? <EmptyState />}
    </section>
  );
}
