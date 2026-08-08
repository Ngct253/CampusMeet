import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiClient: { request } }));

import { approveTranscript } from './service';

describe('Transcript service', () => {
  beforeEach(() => request.mockReset());

  it('posts the shared approval request with the required idempotency header', async () => {
    const result = { transcript: { transcriptId: 'transcript/one' }, aiJob: { aiJobId: 'job-1' } };
    request.mockResolvedValue({ success: true, data: result, requestId: 'request-1' });

    await expect(
      approveTranscript('transcript/one', { expectedVersion: 7 }, 'attempt-key'),
    ).resolves.toBe(result);
    expect(request).toHaveBeenCalledWith('/transcripts/transcript%2Fone/approve', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'attempt-key' },
      body: JSON.stringify({ expectedVersion: 7 }),
    });
  });
});
