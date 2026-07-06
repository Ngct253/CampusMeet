import type { CreateTaskRequest, UpdateTaskStatusRequest } from '@campusmeet/shared';
import { createSkeletonHandler } from './skeleton';
export const tasksHandler = createSkeletonHandler<CreateTaskRequest | UpdateTaskStatusRequest>(
  'Tasks',
);
