import type { ReactNode } from 'react';
import { EmptyState, PageHeader } from './ui';

export function FeaturePage({
  title,
  description,
  todo,
  children,
}: {
  title: string;
  description: string;
  todo: string;
  children?: ReactNode;
}) {
  return (
    <section>
      <PageHeader title={title} description={description} />
      {children ?? <EmptyState />}
      <p className="todo">TODO: {todo}</p>
    </section>
  );
}
