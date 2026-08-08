import { createHash } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3ImmutableObjectStore } from '../src/integrations/s3';

const key = 'uploads/group-1/meeting-1/transcripts/tx/v1/content.txt';
const content = 'Speaker 1: Xin chào';
const bytes = Buffer.from(content, 'utf8');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const storeWith = (...responses: Array<{ value?: unknown; error?: unknown }>) => {
  const send = vi.fn();
  for (const response of responses) {
    if ('error' in response) send.mockRejectedValueOnce(response.error);
    else send.mockResolvedValueOnce(response.value ?? {});
  }
  return {
    send,
    store: new S3ImmutableObjectStore({ send } as unknown as S3Client, () => 'bucket'),
  };
};

describe('S3ImmutableObjectStore', () => {
  it('conditionally writes the exact bytes, SHA-256, content type and caller key', async () => {
    const { store, send } = storeWith({});
    await expect(
      store.writeImmutable({ objectKey: key, content, contentType: 'text/plain; charset=utf-8' }),
    ).resolves.toEqual({ objectKey: key, sha256, sizeBytes: bytes.length, replayed: false });
    const input = send.mock.calls[0]![0].input;
    expect(input).toMatchObject({
      Bucket: 'bucket',
      Key: key,
      ContentType: 'text/plain; charset=utf-8',
      ContentLength: bytes.length,
      IfNoneMatch: '*',
      ServerSideEncryption: 'AES256',
      Metadata: { sha256 },
      ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
    });
    expect(Buffer.from(input.Body)).toEqual(bytes);
  });

  it('accepts a pre-existing exact object as a replay', async () => {
    const precondition = Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
    const { store, send } = storeWith(
      { error: precondition },
      {
        value: {
          ContentLength: bytes.length,
          ContentType: 'text/plain',
          Metadata: { sha256 },
        },
      },
    );
    await expect(
      store.writeImmutable({ objectKey: key, content: bytes, contentType: 'text/plain' }),
    ).resolves.toMatchObject({ replayed: true, sha256 });
    expect(send.mock.calls[1]![0].input).toMatchObject({
      Bucket: 'bucket',
      Key: key,
      ChecksumMode: 'ENABLED',
    });
  });

  it.each([
    [
      'checksum',
      { ContentLength: bytes.length, ContentType: 'text/plain', Metadata: { sha256: 'wrong' } },
    ],
    [
      'length',
      { ContentLength: bytes.length + 1, ContentType: 'text/plain', Metadata: { sha256 } },
    ],
    [
      'content type',
      { ContentLength: bytes.length, ContentType: 'application/json', Metadata: { sha256 } },
    ],
  ])('rejects replay with mismatched %s', async (_label, head) => {
    const precondition = Object.assign(new Error('exists'), { $metadata: { httpStatusCode: 412 } });
    const { store } = storeWith({ error: precondition }, { value: head });
    await expect(
      store.writeImmutable({ objectKey: key, content, contentType: 'text/plain' }),
    ).rejects.toThrow('IMMUTABLE_USER_CONTENT_DATA_INTEGRITY');
  });

  it.each([
    'outside/file.txt',
    '/uploads/file.txt',
    'uploads/../secret',
    'uploads/group\\file',
    'uploads//file',
  ])('rejects an invalid uploads key %s before S3', async (objectKey) => {
    const { store, send } = storeWith();
    await expect(
      store.writeImmutable({ objectKey, content, contentType: 'text/plain' }),
    ).rejects.toThrow('USER_CONTENT_OBJECT_KEY_INVALID');
    expect(send).not.toHaveBeenCalled();
  });

  it('rethrows a non-precondition S3 error unchanged', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'AccessDenied' });
    const { store } = storeWith({ error: denied });
    await expect(
      store.writeImmutable({ objectKey: key, content, contentType: 'text/plain' }),
    ).rejects.toBe(denied);
  });
});
