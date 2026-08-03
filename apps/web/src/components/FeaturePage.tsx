import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from './ui';

export function FeaturePage({
  title,
  description,
  todo,
  children,
}: {
  title: string;
  description: string;
  todo?: string;
  backTo?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  return (
    <section className="feature-page">
      <div className="feature-page-heading">
        <PageHeader title={title} description={description} />
        
      </div>
      {children ?? <EmptyState />}
      {todo && <p className="todo">TODO: {todo}</p>}
    </section>
  );
}
