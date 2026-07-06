import type {
  CreateMeetingRequest,
  UpdateMeetingRequest,
  CancelMeetingRequest,
} from '@campusmeet/shared';
import { createSkeletonHandler } from './skeleton';
export const meetingsHandler = createSkeletonHandler<
  CreateMeetingRequest | UpdateMeetingRequest | CancelMeetingRequest
>('Meetings');
