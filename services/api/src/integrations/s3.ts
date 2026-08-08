import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ServiceConfigurationError } from '../utils/errors';

const client = new S3Client({
  region: process.env.AWS_REGION ?? 'ap-southeast-1',
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

const bucketName = () => {
  const value = process.env.USER_CONTENT_BUCKET ?? process.env.S3_BUCKET_NAME;
  if (!value) throw new ServiceConfigurationError('Thiếu cấu hình USER_CONTENT_BUCKET.');
  return value;
};

export interface AttachmentObjectStore {
  createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    checksum: string;
  }): Promise<string>;
  createDownloadUrl(objectKey: string): Promise<string>;
  head(objectKey: string): Promise<{
    sizeBytes: number;
    contentType?: string;
    checksum?: string;
  }>;
}

export interface ImmutableObjectStore {
  writeImmutable(input: {
    objectKey: string;
    content: string | Uint8Array;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ objectKey: string; sha256: string; sizeBytes: number; replayed: boolean }>;
}

const validateUploadKey = (objectKey: string) => {
  if (
    !objectKey.startsWith('uploads/') ||
    objectKey.startsWith('/') ||
    objectKey.includes('..') ||
    objectKey.includes('\\') ||
    objectKey.split('/').some((part) => !part)
  ) {
    throw new Error('USER_CONTENT_OBJECT_KEY_INVALID');
  }
};

export class S3ImmutableObjectStore implements ImmutableObjectStore {
  constructor(
    private readonly s3: S3Client = client,
    private readonly resolveBucket: () => string = bucketName,
  ) {}

  async writeImmutable(input: Parameters<ImmutableObjectStore['writeImmutable']>[0]) {
    validateUploadKey(input.objectKey);
    const bytes =
      typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
    const digest = createHash('sha256').update(bytes).digest();
    const sha256 = digest.toString('hex');
    const bucket = this.resolveBucket();
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.objectKey,
          Body: bytes,
          ContentType: input.contentType,
          ContentLength: bytes.byteLength,
          Metadata: { ...input.metadata, sha256 },
          ChecksumSHA256: digest.toString('base64'),
          ServerSideEncryption: 'AES256',
          IfNoneMatch: '*',
        }),
      );
      return { objectKey: input.objectKey, sha256, sizeBytes: bytes.byteLength, replayed: false };
    } catch (error) {
      const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (candidate.name !== 'PreconditionFailed' && candidate.$metadata?.httpStatusCode !== 412) {
        throw error;
      }
      const existing = await this.s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: input.objectKey, ChecksumMode: 'ENABLED' }),
      );
      if (
        existing.ContentLength !== bytes.byteLength ||
        existing.ContentType !== input.contentType ||
        existing.Metadata?.sha256 !== sha256
      ) {
        throw new Error('IMMUTABLE_USER_CONTENT_DATA_INTEGRITY');
      }
      return { objectKey: input.objectKey, sha256, sizeBytes: bytes.byteLength, replayed: true };
    }
  }
}

export class S3AttachmentObjectStore implements AttachmentObjectStore {
  constructor(
    private readonly s3: S3Client = client,
    private readonly signer: typeof getSignedUrl = getSignedUrl,
  ) {}

  async createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    checksum: string;
  }): Promise<string> {
    return this.signer(
      this.s3,
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: input.objectKey,
        ContentType: input.contentType,
        Metadata: { checksum: input.checksum },
      }),
      {
        expiresIn: 300,
        unhoistableHeaders: new Set(['x-amz-meta-checksum']),
      },
    );
  }

  async createDownloadUrl(objectKey: string): Promise<string> {
    return this.signer(this.s3, new GetObjectCommand({ Bucket: bucketName(), Key: objectKey }), {
      expiresIn: 900,
    });
  }

  async head(objectKey: string) {
    const result = await this.s3.send(
      new HeadObjectCommand({ Bucket: bucketName(), Key: objectKey }),
    );
    return {
      sizeBytes: result.ContentLength ?? 0,
      ...(result.ContentType ? { contentType: result.ContentType } : {}),
      ...(result.Metadata?.checksum ? { checksum: result.Metadata.checksum } : {}),
    };
  }
}

export const attachmentObjectStore = new S3AttachmentObjectStore();
export const immutableObjectStore = new S3ImmutableObjectStore();
import { createHash } from 'node:crypto';
