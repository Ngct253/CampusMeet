import {
  GroupRole,
  transcriptWithSegmentsSchema,
  type UpdateTranscriptSegmentRequest,
} from '@campusmeet/shared';
import type { TranscriptRepository } from '../domain/transcript-ports';
import type { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import type { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import {
  ConflictError,
  ForbiddenError,
  ResourceNotFoundError,
  UnprocessableEntityError,
} from '../utils/errors';

type Meetings = Pick<DynamoDbMeetingRepository, 'getById'>;
type Memberships = Pick<DynamoDbCollaborationRepository, 'getMembership'>;
export class TranscriptService {
  constructor(
    private readonly transcripts: TranscriptRepository,
    private readonly meetings: Meetings,
    private readonly memberships: Memberships,
  ) {}
  async get(actorId: string, meetingId: string, limit = 50, cursor?: string) {
    const meeting = await this.meetings.getById(meetingId);
    if (!meeting) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
    const membership = await this.memberships.getMembership(meeting.groupId, actorId);
    if (!membership?.active)
      throw new ForbiddenError('Bạn không phải thành viên đang hoạt động của nhóm này.');
    return transcriptWithSegmentsSchema.parse(
      await this.transcripts.getCanonical(meetingId, meeting.groupId, limit, cursor),
    );
  }
  async edit(
    actorId: string,
    transcriptId: string,
    segmentId: string,
    input: UpdateTranscriptSegmentRequest,
  ) {
    const transcript = await this.transcripts.getById(transcriptId);
    if (!transcript) throw new ResourceNotFoundError('Không tìm thấy transcript.');
    const meeting = await this.meetings.getById(transcript.meetingId);
    if (!meeting) throw new Error('TRANSCRIPT_DATA_INTEGRITY');
    if (meeting.groupId !== transcript.groupId) throw new Error('TRANSCRIPT_DATA_INTEGRITY');
    const membership = await this.memberships.getMembership(meeting.groupId, actorId);
    if (
      !membership?.active ||
      (meeting.organizerId !== actorId && membership.role !== GroupRole.GROUP_ADMIN)
    )
      throw new ForbiddenError('Chỉ Người tổ chức hoặc Quản trị viên nhóm được sửa transcript.');
    if (!['READY', 'APPROVED'].includes(transcript.status))
      throw new UnprocessableEntityError('Transcript ở trạng thái hiện tại không thể chỉnh sửa.');
    if (input.expectedVersion !== transcript.version)
      throw new ConflictError('Transcript đã được cập nhật bởi yêu cầu khác.');
    return this.transcripts.updateSegment({ transcript, segmentId, actorId, update: input });
  }
}
