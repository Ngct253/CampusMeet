import type { CreateMinutesRequest } from '@campusmeet/shared';
import { createSkeletonHandler } from './skeleton';
export const minutesHandler = createSkeletonHandler<CreateMinutesRequest>('Meeting minutes');
