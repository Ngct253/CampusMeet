import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { BedrockGroundedGenerator } from '../src/providers/bedrock-grounded-generator';
import { BedrockKnowledgeRetriever } from '../src/providers/bedrock-knowledge-base';
import { S3SourceObjectStore } from '../src/providers/s3-source-object-store';
import type { SourceChunk } from '../src/domain/ports';

const chunk: SourceChunk = {
  text: 'Nhóm thống nhất hoàn thành báo cáo.',
  citation: {
    citationId: 'citation-1',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    sourceType: 'TRANSCRIPT',
    sourceId: 'transcript-1',
    sourceVersion: 1,
    internalUri: 'campusmeet://meetings/meeting-1/sources/transcript-1',
  },
  provenance: { kind: 'INDEXED', approved: true, ingestionStatus: 'READY' },
};

describe('AWS Phase 3 adapters', () => {
  it('writes normalized content and Bedrock metadata sidecar without exposing a URL', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new S3SourceObjectStore({ send } as unknown as S3Client, 'content-bucket');

    await store.writeNormalized({
      key: 'kb/group-1/meeting-1/source-1/v1/content.txt',
      text: 'normalized',
      metadata: { groupId: 'group-1', approved: true },
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'content-bucket',
      Key: 'kb/group-1/meeting-1/source-1/v1/content.txt',
      ServerSideEncryption: 'AES256',
    });
    expect(send.mock.calls[1]![0].input).toMatchObject({
      Key: 'kb/group-1/meeting-1/source-1/v1/content.txt.metadata.json',
      Body: JSON.stringify({ metadataAttributes: { groupId: 'group-1', approved: true } }),
    });
  });

  it('rejects unsafe object keys before calling S3', async () => {
    const send = vi.fn();
    const store = new S3SourceObjectStore({ send } as unknown as S3Client, 'content-bucket');

    await expect(store.read('../secret')).rejects.toThrow('INVALID_OBJECT_KEY');
    expect(send).not.toHaveBeenCalled();
  });

  it('constructs authorization scope filters before Bedrock retrieval', async () => {
    const send = vi.fn().mockResolvedValue({ retrievalResults: [] });
    const retriever = new BedrockKnowledgeRetriever(
      { send } as unknown as BedrockAgentRuntimeClient,
      'kb-1',
    );

    await retriever.retrieve({
      question: 'Quyết định gì?',
      groupId: 'group-1',
      scope: 'SELECTED_MEETINGS',
      meetingIds: ['meeting-1', 'meeting-2'],
      approvedOnly: true,
      ingestionStatus: 'READY',
      sourceTypes: ['ATTACHMENT', 'TRANSCRIPT', 'MINUTES'],
    });

    const filter =
      send.mock.calls[0]![0].input.retrievalConfiguration.vectorSearchConfiguration.filter;
    expect(filter.andAll).toEqual(
      expect.arrayContaining([
        { equals: { key: 'groupId', value: 'group-1' } },
        { equals: { key: 'approved', value: true } },
        { equals: { key: 'ingestionStatus', value: 'READY' } },
        { in: { key: 'meetingId', value: ['meeting-1', 'meeting-2'] } },
      ]),
    );
  });

  it('maps only model citation ids back to canonical citations', async () => {
    const send = vi.fn().mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: JSON.stringify({
                answer: 'Nhóm đã thống nhất.',
                citationIds: ['citation-1'],
                insufficientContext: false,
              }),
            },
          ],
        },
      },
    });
    const generator = new BedrockGroundedGenerator(
      { send } as unknown as BedrockRuntimeClient,
      'model-from-environment',
    );

    const answer = await generator.answer({
      question: 'Quyết định gì?',
      scope: 'CURRENT_MEETING',
      chunks: [chunk],
      lateJoin: false,
    });

    expect(answer.citations).toEqual([chunk.citation]);
    expect(send.mock.calls[0]![0].input.modelId).toBe('model-from-environment');
  });

  it('rejects fabricated citation ids from the model', async () => {
    const send = vi.fn().mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: JSON.stringify({
                answer: 'Không có căn cứ.',
                citationIds: ['fabricated'],
                insufficientContext: false,
              }),
            },
          ],
        },
      },
    });
    const generator = new BedrockGroundedGenerator(
      { send } as unknown as BedrockRuntimeClient,
      'model-from-environment',
    );

    await expect(
      generator.answer({
        question: 'Quyết định gì?',
        scope: 'CURRENT_MEETING',
        chunks: [chunk],
        lateJoin: false,
      }),
    ).rejects.toThrow('UNGROUNDED_MODEL_OUTPUT');
  });
});
