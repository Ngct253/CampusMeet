import { TaskStatus, type DashboardResponse } from '@campusmeet/shared';
import type { TaskRepository } from '../domain/ports';

type AssignedTaskReader = Pick<TaskRepository, 'listByAssignee'>;
type Clock = () => Date;

export class DashboardService {
  constructor(
    private readonly tasks: AssignedTaskReader,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async getPersonalTaskSummary(userId: string): Promise<DashboardResponse> {
    const assignedTasks = await this.tasks.listByAssignee(userId);
    const generatedAtDate = this.clock();
    const generatedAt = generatedAtDate.toISOString();
    const summary = { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 };

    for (const task of assignedTasks) {
      if (task.status === TaskStatus.TODO) summary.todo += 1;
      if (task.status === TaskStatus.DOING) summary.doing += 1;
      if (task.status === TaskStatus.DONE) summary.done += 1;
      if (
        task.status !== TaskStatus.DONE &&
        task.dueAt !== undefined &&
        Date.parse(task.dueAt) < generatedAtDate.getTime()
      ) {
        summary.overdue += 1;
      }
    }

    summary.total = summary.todo + summary.doing + summary.done;
    return { generatedAt, tasks: summary };
  }
}
