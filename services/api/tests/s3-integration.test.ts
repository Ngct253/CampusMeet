import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3AttachmentObjectStore } from '../src/integrations/s3';
import type { S3Client } from '@aws-sdk/client-s3';

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

  it('preserves presigned download behavior', async () => {
    vi.mocked(getSignedUrl).mockResolvedValue('https://example.com/download');
    const result = await new S3AttachmentObjectStore().createDownloadUrl(
      'uploads/group-1/meeting-1/attachment-1',
    );
    expect(result).toBe('https://example.com/download');
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getSignedUrl).mock.calls[0]![1].input).toMatchObject({
      Bucket: 'campusmeet-upload-test',
      Key: 'uploads/group-1/meeting-1/attachment-1',
    });
  });

  it('preserves HeadObject metadata mapping', async () => {
    const send = vi.fn().mockResolvedValue({
      ContentLength: 42,
      ContentType: 'text/plain',
      Metadata: { checksum: 'checksum-1' },
    });
    const store = new S3AttachmentObjectStore({ send } as unknown as S3Client);
    await expect(store.head('uploads/group-1/meeting-1/attachment-1')).resolves.toEqual({
      sizeBytes: 42,
      contentType: 'text/plain',
      checksum: 'checksum-1',
    });
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'campusmeet-upload-test',
      Key: 'uploads/group-1/meeting-1/attachment-1',
    });
  });
});
