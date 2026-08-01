import type { Meeting } from '@campusmeet/shared';
import type { MeetingRepository } from '../domain/ports';
import { NotImplementedError } from '../utils/errors';

export class DynamoDbMeetingRepository implements MeetingRepository {
  getById(_id: string): Promise<Meeting | null> {
    // TODO(M2): implement with the meeting-data table after checking group membership.
    throw new NotImplementedError('DynamoDB meeting repository is not implemented');
  }
}
