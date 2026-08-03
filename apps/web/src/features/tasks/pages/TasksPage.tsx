import { useQuery } from '@tanstack/react-query';
import { FeaturePage } from '../../../components/FeaturePage';
import { StatusBadge } from '../../../components/ui';
import { getTasks } from '../service';

export const TasksPage = () => {
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: getTasks });

  return (
    <FeaturePage title="Công việc" description="Theo dõi công việc được giao và tiến độ cá nhân.">
      {tasksQuery.isPending ? (
        <p role="status">Đang tải công việc…</p>
      ) : tasksQuery.isError ? (
        <div role="alert">
          <strong>Chưa thể tải công việc</strong>
          <p>Kiểm tra kết nối rồi thử lại.</p>
          <button type="button" onClick={() => void tasksQuery.refetch()}>
            Thử lại
          </button>
        </div>
      ) : tasksQuery.data.length === 0 ? (
        <div>
          <strong>Chưa có công việc được giao</strong>
          <p>Công việc mới được giao cho bạn sẽ xuất hiện tại đây.</p>
        </div>
      ) : (
        <div className="list">
          {tasksQuery.data.map((task) => (
            <article key={task.id}>
              <strong>{task.title}</strong> <StatusBadge>{task.status}</StatusBadge>
              <p>Ưu tiên: {task.priority}</p>
            </article>
          ))}
        </div>
      )}
    </FeaturePage>
  );
};
