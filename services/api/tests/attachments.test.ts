import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIJob } from '@campusmeet/shared';
import { documentClient } from '../src/repositories/client';
import { DynamoDbAttachmentRepository } from '../src/repositories/attachments';

const attachmentItem = {
  PK: 'ATTACHMENT#att-1',
  SK: 'META',
  attachmentId: 'att-1',
  meetingId: 'meeting-1',
  groupId: 'group-1',
  fileName: 'notes.pdf',
  contentType: 'application/pdf',
  sizeBytes: 123,
  checksum: 'abc123',
  objectKey: 'uploads/group-1/meeting-1/att-1',
  status: 'PENDING_UPLOAD',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const queuedJob: AIJob = {
  aiJobId: 'aij-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceId: 'att-1',
  type: 'INGEST_SOURCE',
  status: 'QUEUED',
  attempt: 0,
  requestId: 'request-1',
  provider: 'BEDROCK',
  createdAt: '2026-08-06T00:00:01.000Z',
  updatedAt: '2026-08-06T00:00:01.000Z',
};

describe('DynamoDbAttachmentRepository.completeUpload', () => {
  beforeEach(() => {
    process.env.MEETING_DATA_TABLE = 'meeting-data-test';
    vi.restoreAllMocks();
  });

  it('xác minh S3 và tạo đúng AIJob ingestion trước khi chuyển sang UPLOADED', async () => {
    const send = vi.spyOn(documentClient, 'send');
    send
      .mockResolvedValueOnce({ Item: attachmentItem } as never)
      .mockResolvedValueOnce({
        Attributes: {
          ...attachmentItem,
          status: 'UPLOADED',
          aiJobId: queuedJob.aiJobId,
          updatedAt: '2026-08-06T00:00:01.000Z',
        },
      } as never);
    const objects = {
      createUploadUrl: vi.fn(),
      createDownloadUrl: vi.fn(),
      head: vi.fn().mockResolvedValue({
        sizeBytes: 123,
        contentType: 'application/pdf',
        checksum: 'abc123',
      }),
    };
    const jobs = { enqueue: vi.fn().mockResolvedValue(queuedJob) };
    const repository = new DynamoDbAttachmentRepository(objects, jobs);

    const result = await repository.completeUpload('att-1', 'abc123', 'request-1', 'user-1');

    expect(objects.head).toHaveBeenCalledWith(attachmentItem.objectKey);
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        idempotencyKey: 'attachment:att-1:v1',
        type: 'INGEST_SOURCE',
        payload: expect.objectContaining({
          operation: 'INGEST_SOURCE',
          sourceId: 'att-1',
          approved: true,
        }),
      }),
    );
    expect(result.attachment.status).toBe('UPLOADED');
    expect(result.aiJob.aiJobId).toBe('aij-1');
  });

  it('không tạo AIJob nếu metadata checksum trên S3 không khớp', async () => {
    vi.spyOn(documentClient, 'send').mockResolvedValueOnce({ Item: attachmentItem } as never);
    const objects = {
      createUploadUrl: vi.fn(),
      createDownloadUrl: vi.fn(),
      head: vi.fn().mockResolvedValue({
        sizeBytes: 123,
        contentType: 'application/pdf',
        checksum: 'different',
      }),
    };
    const jobs = { enqueue: vi.fn() };
    const repository = new DynamoDbAttachmentRepository(objects, jobs);

    await expect(
      repository.completeUpload('att-1', 'abc123', 'request-1', 'user-1'),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
