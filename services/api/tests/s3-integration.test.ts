import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3AttachmentObjectStore } from '../src/integrations/s3';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

describe('S3AttachmentObjectStore', () => {
  beforeEach(() => {
    process.env.USER_CONTENT_BUCKET = 'campusmeet-upload-test';
    vi.mocked(getSignedUrl).mockReset();
  });

  it('tạo URL upload không gắn checksum CRC32 của payload rỗng và ký metadata CampusMeet', async () => {
    vi.mocked(getSignedUrl).mockImplementation(async (client, _command, options) => {
      expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED');
      expect(options?.unhoistableHeaders).toEqual(new Set(['x-amz-meta-checksum']));
      return 'https://example.com/upload';
    });
    const store = new S3AttachmentObjectStore();

    const result = await store.createUploadUrl({
      objectKey: 'uploads/group-1/meeting-1/attachment-1',
      contentType: 'text/plain',
      checksum: 'a'.repeat(64),
    });

    expect(result).toBe('https://example.com/upload');
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });
});
