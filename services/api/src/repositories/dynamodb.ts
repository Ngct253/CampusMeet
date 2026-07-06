import type { Group, Meeting } from '@campusmeet/shared';
import type { GroupRepository, MeetingRepository } from '../domain/ports';
import { NotImplementedError } from '../utils/errors';

export class DynamoDbGroupRepository implements GroupRepository {
  getById(_id: string): Promise<Group | null> {
    // TODO(M2/M3): implement with the group table and membership authorization boundary.
    throw new NotImplementedError('DynamoDB group repository is not implemented');
  }
}

export class DynamoDbMeetingRepository implements MeetingRepository {
  getById(_id: string): Promise<Meeting | null> {
    // TODO(M2/M3): implement with the meeting table; never expose a cross-group record.
    throw new NotImplementedError('DynamoDB meeting repository is not implemented');
  }
}
