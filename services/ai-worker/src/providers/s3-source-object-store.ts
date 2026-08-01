import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { SourceObjectStore } from '../domain/ports';

const validateKey = (key: string) => {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new Error('INVALID_OBJECT_KEY');
  }
};

export class S3SourceObjectStore implements SourceObjectStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string,
  ) {}

  async read(key: string): Promise<Uint8Array> {
    validateKey(key);
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
    if (!response.Body) throw new Error('SOURCE_OBJECT_NOT_FOUND');
    return response.Body.transformToByteArray();
  }

  async writeNormalized(input: Parameters<SourceObjectStore['writeNormalized']>[0]): Promise<void> {
    validateKey(input.key);
    const metadataKey = `${input.key}.metadata.json`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: input.key,
        Body: input.text,
        ContentType: 'text/plain; charset=utf-8',
        ServerSideEncryption: 'AES256',
      }),
    );
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: metadataKey,
        Body: JSON.stringify({ metadataAttributes: input.metadata }),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      }),
    );
  }
}
