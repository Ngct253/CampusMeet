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

export class S3AttachmentObjectStore implements AttachmentObjectStore {
  async createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    checksum: string;
  }): Promise<string> {
    return getSignedUrl(
      client,
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
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucketName(), Key: objectKey }), {
      expiresIn: 900,
    });
  }

  async head(objectKey: string) {
    const result = await client.send(
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
