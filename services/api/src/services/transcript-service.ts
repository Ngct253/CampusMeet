import {
  approveTranscriptResponseSchema,
  GroupRole,
  type ApproveTranscriptRequest,
  type ApproveTranscriptResponse,
  type TranscriptSegment,
  transcriptWithSegmentsSchema,
  type UpdateTranscriptSegmentRequest,
} from '@campusmeet/shared';
import type { AIJobOrchestrator } from '../ai/ports';
import type { TranscriptRepository } from '../domain/transcript-ports';
import type { ImmutableObjectStore } from '../integrations/s3';
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
type ApprovalDependencies = {
  objects: ImmutableObjectStore;
  jobs: AIJobOrchestrator;
};

export const serializeTranscriptSegments = (segments: TranscriptSegment[]): Uint8Array => {
  const ordered = [...segments].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      (left.segmentId < right.segmentId ? -1 : left.segmentId > right.segmentId ? 1 : 0),
  );
  return Buffer.from(
    `${ordered
      .map((segment) => `${segment.speakerLabel}: ${segment.text.replace(/\r\n?/g, '\n')}`)
      .join('\n')}\n`,
    'utf8',
  );
};
export class TranscriptService {
  constructor(
    private readonly transcripts: TranscriptRepository,
    private readonly meetings: Meetings,
    private readonly memberships: Memberships,
    private readonly approval?: ApprovalDependencies,
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

  async approve(
    actorId: string,
    transcriptId: string,
    input: ApproveTranscriptRequest,
    idempotencyKey: string,
    requestId: string,
  ): Promise<ApproveTranscriptResponse> {
    if (!this.approval) throw new Error('TRANSCRIPT_APPROVAL_CONFIGURATION_ERROR');
    const transcript = await this.transcripts.getById(transcriptId);
    if (!transcript) throw new ResourceNotFoundError('Không tìm thấy transcript.');
    const meeting = await this.meetings.getById(transcript.meetingId);
    if (!meeting || meeting.groupId !== transcript.groupId)
      throw new Error('TRANSCRIPT_DATA_INTEGRITY');
    const membership = await this.memberships.getMembership(meeting.groupId, actorId);
    if (
      !membership?.active ||
      (meeting.organizerId !== actorId && membership.role !== GroupRole.GROUP_ADMIN)
    )
      throw new ForbiddenError('Chỉ Người tổ chức hoặc Quản trị viên nhóm được duyệt transcript.');

    const intent = await this.transcripts.getApprovalIntent(actorId, idempotencyKey);
    if (
      intent &&
      (intent.transcriptId !== transcriptId || intent.expectedVersion !== input.expectedVersion)
    )
      throw new ConflictError('Idempotency-Key đã được dùng cho một yêu cầu duyệt khác.');
    if (input.expectedVersion !== transcript.version)
      throw new ConflictError('Transcript đã được cập nhật bởi yêu cầu khác.');

    if (transcript.status === 'APPROVED' && transcript.approvedVersion === transcript.version) {
      const handoff = await this.transcripts.getApprovalHandoff(transcriptId, transcript.version);
      if (
        !handoff ||
        handoff.meetingId !== transcript.meetingId ||
        handoff.groupId !== transcript.groupId
      )
        throw new Error('TRANSCRIPT_DATA_INTEGRITY');
      await this.transcripts.bindApprovalIntent({
        actorId,
        idempotencyKey,
        transcriptId,
        expectedVersion: input.expectedVersion,
        aiJobId: handoff.aiJobId,
      });
      const aiJob = await this.approval.jobs.ensureStarted(handoff.aiJobId);
      return approveTranscriptResponseSchema.parse({ transcript, aiJob });
    }
    if (transcript.status !== 'READY')
      throw new UnprocessableEntityError('Transcript chưa sẵn sàng để duyệt.');

    const segments = await this.transcripts.getAllSegments(transcriptId, transcript.version);
    const artifactObjectKey = `uploads/${transcript.groupId}/${transcript.meetingId}/transcripts/${transcriptId}/v${transcript.version}/content.txt`;
    const frozen = await this.approval.objects.writeImmutable({
      objectKey: artifactObjectKey,
      content: serializeTranscriptSegments(segments),
      contentType: 'text/plain',
    });
    const preparedJob = this.approval.jobs.prepareJob({
      groupId: transcript.groupId,
      meetingId: transcript.meetingId,
      requestId,
      type: 'INGEST_SOURCE',
      payload: {
        operation: 'INGEST_SOURCE',
        actorId,
        groupId: transcript.groupId,
        meetingId: transcript.meetingId,
        sourceId: transcriptId,
        sourceType: 'TRANSCRIPT',
        sourceVersion: transcript.version,
        approved: true,
        inputObjectKey: artifactObjectKey,
        contentType: 'text/plain',
      },
    });
    const approved = await this.transcripts.approve({
      transcript,
      actorId,
      requestId,
      idempotencyKey,
      request: input,
      artifactObjectKey,
      artifactChecksum: frozen.sha256,
      preparedJob,
    });
    const aiJob = await this.approval.jobs.ensureStarted(approved.handoff.aiJobId);
    return approveTranscriptResponseSchema.parse({ transcript: approved.transcript, aiJob });
  }
}
