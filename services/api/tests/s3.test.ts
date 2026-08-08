import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';

const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://upload.example.test'),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }));

import { S3AttachmentObjectStore } from '../src/integrations/s3';

describe('S3AttachmentObjectStore', () => {
  beforeEach(() => {
    process.env.USER_CONTENT_BUCKET = 'campusmeet-test-uploads';
    getSignedUrl.mockClear();
  });

  it('keeps the checksum metadata header signed for browser uploads', async () => {
    const store = new S3AttachmentObjectStore();

    await store.createUploadUrl({
      objectKey: 'uploads/group-1/meeting-1/attachment-1',
      contentType: 'text/plain',
      checksum: 'checksum-1',
    });

    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        expiresIn: 300,
        unhoistableHeaders: new Set(['x-amz-meta-checksum']),
      }),
    );
  });

  it('produces a URL that signs the browser checksum header', async () => {
    getSignedUrl.mockRestore();
    const { getSignedUrl: actualGetSignedUrl } = await vi.importActual<
      typeof import('@aws-sdk/s3-request-presigner')
    >('@aws-sdk/s3-request-presigner');
    getSignedUrl.mockImplementation(actualGetSignedUrl);
    const client = new S3Client({
      region: 'ap-southeast-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const store = new S3AttachmentObjectStore(client);

    const url = await store.createUploadUrl({
      objectKey: 'uploads/group-1/meeting-1/attachment-1',
      contentType: 'text/plain',
      checksum: 'checksum-1',
    });

    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-meta-checksum');
  });
});
