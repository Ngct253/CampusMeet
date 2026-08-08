import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface ImmutableUserContentIdentity {
  namespace: string;
  groupId: string;
  resourceId: string;
  version: number;
}

export interface ImmutableUserContentWriteInput {
  identity: ImmutableUserContentIdentity;
  body: string | Uint8Array;
  contentType: string;
}

export interface ImmutableUserContentWriteResult {
  objectKey: string;
  checksumSha256: string;
  replayed: boolean;
}

export interface ImmutableUserContentWriter {
  write(input: ImmutableUserContentWriteInput): Promise<ImmutableUserContentWriteResult>;
}

interface S3Sender {
  send(command: unknown): Promise<unknown>;
}

export class UserContentIntegrityError extends Error {
  readonly code = 'USER_CONTENT_INTEGRITY_ERROR';

  constructor(message = 'Immutable user content does not match the existing object.') {
    super(message);
    this.name = 'UserContentIntegrityError';
  }
}

const encodeSegment = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new UserContentIntegrityError(`${name} must not be empty.`);
  return encodeURIComponent(normalized);
};

export const immutableUserContentKey = (identity: ImmutableUserContentIdentity): string => {
  if (!Number.isSafeInteger(identity.version) || identity.version < 1) {
    throw new UserContentIntegrityError('version must be a positive safe integer.');
  }
  return [
    'immutable',
    encodeSegment(identity.namespace, 'namespace'),
    encodeSegment(identity.groupId, 'groupId'),
    encodeSegment(identity.resourceId, 'resourceId'),
    `v${identity.version}`,
  ].join('/');
};

const bytes = (body: string | Uint8Array): Uint8Array =>
  typeof body === 'string' ? Buffer.from(body, 'utf8') : body;

const sha256Hex = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');
const sha256Base64 = (body: Uint8Array): string =>
  createHash('sha256').update(body).digest('base64');

const isPreconditionFailure = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'PreconditionFailed' || candidate.$metadata?.httpStatusCode === 412;
};

export class S3ImmutableUserContentWriter implements ImmutableUserContentWriter {
  constructor(
    private readonly bucket: string,
    private readonly s3: S3Sender = new S3Client({
      region: process.env.AWS_REGION ?? 'ap-southeast-1',
    }),
  ) {
    if (!bucket.trim()) throw new UserContentIntegrityError('bucket must not be empty.');
  }

  async write(input: ImmutableUserContentWriteInput): Promise<ImmutableUserContentWriteResult> {
    const objectKey = immutableUserContentKey(input.identity);
    const content = bytes(input.body);
    const checksumSha256 = sha256Hex(content);

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: content,
          ContentType: input.contentType,
          IfNoneMatch: '*',
          ChecksumSHA256: sha256Base64(content),
          Metadata: { sha256: checksumSha256 },
        }),
      );
      return { objectKey, checksumSha256, replayed: false };
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error;
    }

    const existing = (await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey, ChecksumMode: 'ENABLED' }),
    )) as {
      Body?: { transformToByteArray(): Promise<Uint8Array> };
      ContentType?: string;
      ChecksumSHA256?: string;
      Metadata?: Record<string, string>;
    };
    if (!existing.Body) throw new UserContentIntegrityError('Existing object body is missing.');
    const existingBody = await existing.Body.transformToByteArray();
    const existingChecksum = sha256Hex(existingBody);
    if (
      existingChecksum !== checksumSha256 ||
      existing.ChecksumSHA256 !== sha256Base64(content) ||
      existing.Metadata?.sha256 !== checksumSha256 ||
      existing.ContentType !== input.contentType
    ) {
      throw new UserContentIntegrityError();
    }
    return { objectKey, checksumSha256, replayed: true };
  }
}

export const createProductionImmutableUserContentWriter = (): ImmutableUserContentWriter => {
  const bucket = process.env.USER_CONTENT_BUCKET ?? process.env.S3_BUCKET_NAME;
  if (!bucket) throw new UserContentIntegrityError('USER_CONTENT_BUCKET is not configured.');
  return new S3ImmutableUserContentWriter(bucket);
};
