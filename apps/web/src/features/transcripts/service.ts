import type {
  ApiSuccessResponse,
  ApproveTranscriptRequest,
  ApproveTranscriptResponse,
  TranscriptWithSegments,
  UpdateTranscriptSegmentRequest,
  Transcript,
  TranscriptSegment,
} from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';
export const getTranscript = async (
  meetingId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<TranscriptWithSegments> => {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  return (
    await apiClient.request<ApiSuccessResponse<TranscriptWithSegments>>(
      `/meetings/${encodeURIComponent(meetingId)}/transcripts${query.size ? `?${query}` : ''}`,
    )
  ).data;
};
export const updateTranscriptSegment = async (
  transcriptId: string,
  segmentId: string,
  input: UpdateTranscriptSegmentRequest,
): Promise<{ transcript: Transcript; segment: TranscriptSegment }> =>
  (
    await apiClient.request<
      ApiSuccessResponse<{ transcript: Transcript; segment: TranscriptSegment }>
    >(
      `/transcripts/${encodeURIComponent(transcriptId)}/segments/${encodeURIComponent(segmentId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    )
  ).data;

export const approveTranscript = async (
  transcriptId: string,
  input: ApproveTranscriptRequest,
  idempotencyKey: string,
): Promise<ApproveTranscriptResponse> =>
  (
    await apiClient.request<ApiSuccessResponse<ApproveTranscriptResponse>>(
      `/transcripts/${encodeURIComponent(transcriptId)}/approve`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input),
      },
    )
  ).data;
