import { FeaturePage } from '../../../components/FeaturePage';
import { StatusBadge } from '../../../components/ui';
import { mockTasks } from '../../../mocks/data';

export const TasksPage = () => (
  <FeaturePage
    title="Công việc"
    description="Theo dõi công việc được giao và tiến độ cá nhân."
    todo="M3 nối task API."
  >
    <div className="list">
      {mockTasks.map((task) => (
        <article key={task.id}>
          <strong>{task.title}</strong> <StatusBadge>{task.status}</StatusBadge>
          <p>Ưu tiên: {task.priority}</p>
        </article>
      ))}
    </div>
  </FeaturePage>
);
