import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  S3ImmutableUserContentWriter,
  UserContentIntegrityError,
  immutableUserContentKey,
} from '../src/integrations/immutable-user-content';

const identity = {
  namespace: 'meeting-transcript',
  groupId: 'group-1',
  resourceId: 'meeting-1',
  version: 3,
};
const body = Buffer.from('{"approved":true}', 'utf8');
const digest = createHash('sha256').update(body).digest('hex');

describe('S3ImmutableUserContentWriter', () => {
  it('derives a deterministic versioned key and writes once with SHA-256 protection', async () => {
    const send = vi.fn().mockResolvedValue({});
    const writer = new S3ImmutableUserContentWriter('user-content', { send });

    await expect(
      writer.write({ identity, body, contentType: 'application/json' }),
    ).resolves.toEqual({
      objectKey: 'immutable/meeting-transcript/group-1/meeting-1/v3',
      checksumSha256: digest,
      replayed: false,
    });

    const input = send.mock.calls[0]![0].input;
    expect(input).toMatchObject({
      Bucket: 'user-content',
      Key: immutableUserContentKey(identity),
      ContentType: 'application/json',
      IfNoneMatch: '*',
      Metadata: { sha256: digest },
    });
    expect(input.ChecksumSHA256).toBe(createHash('sha256').update(body).digest('base64'));
  });

  it('verifies an identical replay without overwriting the existing object', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'PreconditionFailed' }))
      .mockResolvedValueOnce({
        Body: { transformToByteArray: vi.fn().mockResolvedValue(body) },
        ContentType: 'application/json',
        ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
        Metadata: { sha256: digest },
      });
    const writer = new S3ImmutableUserContentWriter('user-content', { send });

    await expect(
      writer.write({ identity, body, contentType: 'application/json' }),
    ).resolves.toMatchObject({ replayed: true, checksumSha256: digest });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['different bytes', Buffer.from('different'), 'application/json', digest],
    ['different content type', body, 'text/plain', digest],
    ['different metadata', body, 'application/json', 'forged'],
  ])('rejects replay integrity mismatch: %s', async (_label, storedBody, contentType, metadata) => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: vi.fn().mockResolvedValue(storedBody) },
        ContentType: contentType,
        ChecksumSHA256: createHash('sha256').update(storedBody).digest('base64'),
        Metadata: { sha256: metadata },
      });
    const writer = new S3ImmutableUserContentWriter('user-content', { send });

    await expect(
      writer.write({ identity, body, contentType: 'application/json' }),
    ).rejects.toBeInstanceOf(UserContentIntegrityError);
  });

  it('rejects invalid identity components before calling S3', async () => {
    const send = vi.fn();
    const writer = new S3ImmutableUserContentWriter('user-content', { send });
    await expect(
      writer.write({
        identity: { ...identity, resourceId: '', version: 0 },
        body,
        contentType: 'application/json',
      }),
    ).rejects.toBeInstanceOf(UserContentIntegrityError);
    expect(send).not.toHaveBeenCalled();
  });
});
