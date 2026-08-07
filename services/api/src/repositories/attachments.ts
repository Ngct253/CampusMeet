import { createHash } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Attachment, AttachmentDownloadTarget, CompleteUploadResponse, CreateUploadUrlResponse, UploadAttachmentRequest } from '@campusmeet/shared';
import { attachmentSchema, createUploadUrlResponseSchema, completeUploadResponseSchema, attachmentDownloadTargetSchema, documentContentTypeSchema, maxAttachmentsPerMeeting } from '@campusmeet/shared';
import { createProductionAIJobOrchestrator } from '../ai/aws-adapters';
import type { AIJobOrchestrator } from '../ai/ports';
import { attachmentObjectStore, type AttachmentObjectStore } from '../integrations/s3';
import { ConflictError, ResourceNotFoundError, UnprocessableEntityError } from '../utils/errors';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';

const toAttachment = (item: DynamoItem): Attachment | undefined => {
  const attachmentId = stringValue(item, 'attachmentId') ?? stringValue(item, 'PK')?.replace(/^ATTACHMENT#/, '');
  const meetingId = stringValue(item, 'meetingId');
  const groupId = stringValue(item, 'groupId');
  const fileName = stringValue(item, 'fileName');
  const contentType = stringValue(item, 'contentType');
  const checksum = stringValue(item, 'checksum');
  const objectKey = stringValue(item, 'objectKey');
  const status = stringValue(item, 'status');
  const createdAt = stringValue(item, 'createdAt');
  const updatedAt = stringValue(item, 'updatedAt');
  const sizeBytes = typeof item.sizeBytes === 'number' ? item.sizeBytes : undefined;
  if (
    !attachmentId ||
    !meetingId ||
    !groupId ||
    !fileName ||
    !contentType ||
    !checksum ||
    !objectKey ||
    !status ||
    !createdAt ||
    !updatedAt ||
    !sizeBytes
  ) {
    return undefined;
  }
  const attachment = attachmentSchema.safeParse({
    attachmentId,
    meetingId,
    groupId,
    fileName,
    contentType,
    sizeBytes,
    checksum,
    objectKey,
    status,
    createdAt,
    updatedAt,
    ...(stringValue(item, 'readyAt') ? { readyAt: stringValue(item, 'readyAt') } : {}),
    ...(stringValue(item, 'expiresAt') ? { expiresAt: stringValue(item, 'expiresAt') } : {}),
  });
  return attachment.success ? attachment.data : undefined;
};

export class DynamoDbAttachmentRepository {
  private get table() {
    return tableName('MEETING_DATA_TABLE');
  }

  constructor(
    private readonly objects: AttachmentObjectStore = attachmentObjectStore,
    private readonly configuredJobs?: AIJobOrchestrator,
  ) {}

  private jobs() {
    return this.configuredJobs ?? createProductionAIJobOrchestrator();
  }

  async listByMeeting(meetingId: string): Promise<Attachment[]> {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'GSI3',
        KeyConditionExpression: 'GSI3PK = :meeting AND begins_with(GSI3SK, :attachment)',
        ExpressionAttributeValues: {
          ':meeting': `MEETING#${meetingId}`,
          ':attachment': 'ATTACHMENT#',
        },
      }),
    );
    return (result.Items ?? []).flatMap((item) => {
      const attachment = toAttachment(item);
      return attachment ? [attachment] : [];
    });
  }

  async getById(attachmentId: string): Promise<Attachment | null> {
    const result = await documentClient.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: `ATTACHMENT#${attachmentId}`, SK: 'META' },
      }),
    );
    return result.Item ? (toAttachment(result.Item) ?? null) : null;
  }

  async createUploadTarget(
    groupId: string,
    request: UploadAttachmentRequest,
  ): Promise<CreateUploadUrlResponse> {
    const existingAttachments = await this.listByMeeting(request.meetingId);
    if (existingAttachments.length >= maxAttachmentsPerMeeting) {
      throw new ConflictError(`Mỗi cuộc họp chỉ được tối đa ${maxAttachmentsPerMeeting} tệp.`);
    }
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const uploadExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const attachmentId = createHash('sha256')
      .update([groupId, request.meetingId, request.fileName, request.contentType, request.sizeBytes, request.checksum].join(':'))
      .digest('hex')
      .slice(0, 32);
    const objectKey = `uploads/${groupId}/${request.meetingId}/${attachmentId}`;
    const item = {
      PK: `ATTACHMENT#${attachmentId}`,
      SK: 'META',
      entityType: 'ATTACHMENT',
      attachmentId,
      meetingId: request.meetingId,
      groupId,
      fileName: request.fileName,
      contentType: request.contentType,
      sizeBytes: request.sizeBytes,
      checksum: request.checksum,
      objectKey,
      status: 'PENDING_UPLOAD',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      expiresAtEpoch: Math.floor(Date.now() / 1000) + 86_400,
      GSI3PK: `MEETING#${request.meetingId}`,
      GSI3SK: `ATTACHMENT#${now}#${attachmentId}`,
    };
    try {
      await documentClient.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (error) {
      const existing = await this.getById(attachmentId);
      if (!existing) throw error;
      return createUploadUrlResponseSchema.parse({
        attachment: existing,
        uploadUrl: await this.objects.createUploadUrl({
          objectKey: existing.objectKey,
          contentType: existing.contentType,
          checksum: existing.checksum,
        }),
        uploadExpiresAt,
      });
    }
    return createUploadUrlResponseSchema.parse({
      attachment: attachmentSchema.parse(item),
      uploadUrl: await this.objects.createUploadUrl({
        objectKey,
        contentType: request.contentType,
        checksum: request.checksum,
      }),
      uploadExpiresAt,
    });
  }

  async completeUpload(
    attachmentId: string,
    checksum: string,
    requestId: string,
    actorId: string,
  ): Promise<CompleteUploadResponse> {
    const attachment = await this.getById(attachmentId);
    if (!attachment) throw new ResourceNotFoundError('Không tìm thấy tệp đính kèm.');
    if (attachment.checksum !== checksum) {
      throw new UnprocessableEntityError('Checksum không khớp với file đã upload.');
    }
    const object = await this.objects.head(attachment.objectKey);
    if (object.sizeBytes !== attachment.sizeBytes) {
      throw new UnprocessableEntityError('Kích thước object không khớp với yêu cầu upload.');
    }
    if (object.contentType !== attachment.contentType) {
      throw new UnprocessableEntityError('Content-Type của object không hợp lệ.');
    }
    if (object.checksum !== attachment.checksum) {
      throw new UnprocessableEntityError('Checksum metadata của object không hợp lệ.');
    }
    const documentContentType = documentContentTypeSchema.safeParse(attachment.contentType);
    if (!documentContentType.success) {
      throw new UnprocessableEntityError(
        'Luồng xử lý audio chưa được cấu hình; hãy upload tài liệu hoặc cấu hình Amazon Transcribe.',
      );
    }
    const now = new Date().toISOString();
    const aiJob = await this.jobs().enqueue({
      actorId,
      groupId: attachment.groupId,
      meetingId: attachment.meetingId,
      idempotencyKey: `attachment:${attachmentId}:v1`,
      requestId,
      type: 'INGEST_SOURCE',
      payload: {
        operation: 'INGEST_SOURCE',
        actorId,
        groupId: attachment.groupId,
        meetingId: attachment.meetingId,
        sourceId: attachmentId,
        sourceType: 'ATTACHMENT',
        sourceVersion: 1,
        approved: true,
        inputObjectKey: attachment.objectKey,
        contentType: documentContentType.data,
      },
    });
    const updated = await documentClient.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: `ATTACHMENT#${attachmentId}`, SK: 'META' },
        UpdateExpression:
          'SET #status = :status, updatedAt = :updatedAt, aiJobId = :aiJobId',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'UPLOADED',
          ':updatedAt': now,
          ':aiJobId': aiJob.aiJobId,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const nextAttachment = updated.Attributes ? (toAttachment(updated.Attributes) ?? attachment) : attachment;
    return completeUploadResponseSchema.parse({
      attachment: nextAttachment,
      aiJob,
    });
  }

  async createDownloadTarget(attachmentId: string): Promise<AttachmentDownloadTarget> {
    const attachment = await this.getById(attachmentId);
    if (!attachment) throw new ResourceNotFoundError('Không tìm thấy tệp đính kèm.');
    if (attachment.status !== 'READY') {
      throw new ConflictError('Tệp chưa sẵn sàng để tải xuống.');
    }
    const downloadExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return attachmentDownloadTargetSchema.parse({
      attachment,
      downloadUrl: await this.objects.createDownloadUrl(attachment.objectKey),
      downloadExpiresAt,
    });
  }
}
