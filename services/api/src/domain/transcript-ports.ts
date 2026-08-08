import type {
  Transcript,
  TranscriptSegment,
  TranscriptWithSegments,
  UpdateTranscriptSegmentRequest,
} from '@campusmeet/shared';

export interface TranscriptRepository {
  getCanonical(
    meetingId: string,
    groupId: string,
    limit: number,
    cursor?: string,
  ): Promise<TranscriptWithSegments>;
  getById(transcriptId: string): Promise<Transcript | null>;
  updateSegment(input: {
    transcript: Transcript;
    segmentId: string;
    actorId: string;
    update: UpdateTranscriptSegmentRequest;
  }): Promise<{ transcript: Transcript; segment: TranscriptSegment }>;
}
