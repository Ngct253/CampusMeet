import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { S3Client } from '@aws-sdk/client-s3';
import type { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { describe, expect, it, vi } from 'vitest';
import { BedrockGroundedGenerator } from '../src/providers/bedrock-grounded-generator';
import {
  BedrockKnowledgeBaseIngestionGateway,
  BedrockKnowledgeRetriever,
} from '../src/providers/bedrock-knowledge-base';
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

  it('deletes only a normalized object and its Bedrock metadata sidecar', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new S3SourceObjectStore({ send } as unknown as S3Client, 'content-bucket');

    await store.deleteNormalized('kb/group-1/meeting-1/source-1/v1/content.txt');

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'content-bucket',
      Delete: {
        Quiet: true,
        Objects: [
          { Key: 'kb/group-1/meeting-1/source-1/v1/content.txt' },
          { Key: 'kb/group-1/meeting-1/source-1/v1/content.txt.metadata.json' },
        ],
      },
    });
  });

  it('refuses to delete an object outside the normalized knowledge prefix', async () => {
    const send = vi.fn();
    const store = new S3SourceObjectStore({ send } as unknown as S3Client, 'content-bucket');

    await expect(store.deleteNormalized('uploads/group-1/source.txt')).rejects.toThrow(
      'INVALID_NORMALIZED_OBJECT_KEY',
    );
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

  it('normalizes the AI job id into a valid Bedrock ingestion client token', async () => {
    const send = vi.fn().mockResolvedValue({ ingestionJob: { ingestionJobId: 'ingestion-1' } });
    const ingestion = new BedrockKnowledgeBaseIngestionGateway(
      { send } as unknown as BedrockAgentClient,
      'kb-1',
      'source-1',
    );

    await ingestion.start('aij_1234_5678');

    const clientToken = send.mock.calls[0]![0].input.clientToken;
    expect(clientToken).toMatch(/^[a-zA-Z0-9-]{33,256}$/);
    expect(clientToken).toMatch(/^aij-1234-5678-/);
  });

  it('maps only model citation ids back to canonical citations', async () => {
    const generate = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        answer: 'Nhóm đã thống nhất.',
        citationIds: ['citation-1'],
        insufficientContext: false,
      }),
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const generator = new BedrockGroundedGenerator({ generate });

    const answer = await generator.answer({
      question: 'Quyết định gì?',
      scope: 'CURRENT_MEETING',
      chunks: [chunk],
      lateJoin: false,
    });

    expect(answer.value.citations).toEqual([chunk.citation]);
    expect(answer.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('rejects fabricated citation ids from the model', async () => {
    const generate = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        answer: 'Không có căn cứ.',
        citationIds: ['fabricated'],
        insufficientContext: false,
      }),
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const generator = new BedrockGroundedGenerator({ generate });

    await expect(
      generator.answer({
        question: 'Quyết định gì?',
        scope: 'CURRENT_MEETING',
        chunks: [chunk],
        lateJoin: false,
      }),
    ).rejects.toThrow('UNGROUNDED_MODEL_OUTPUT');
  });

  it('retries one malformed structured response and records usage from both attempts', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({ summary: 'Thiếu observations và risks.' }),
        usage: { inputTokens: 80, outputTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'Tiến độ ổn định.',
          observations: ['Ba công việc đã hoàn thành.'],
          risks: [],
        }),
        usage: { inputTokens: 90, outputTokens: 20 },
      });
    const generator = new BedrockGroundedGenerator({ generate });

    const result = await generator.progress({
      groupId: 'group-1',
      version: 1,
      generatedAt: '2026-08-08T08:00:00.000Z',
      taskCounts: { total: 3, todo: 0, doing: 0, done: 3, overdue: 0 },
      meetingCounts: { completed: 1, upcoming: 0 },
    });

    expect(result.value).toMatchObject({
      groupId: 'group-1',
      summary: 'Tiến độ ổn định.',
      observations: ['Ba công việc đã hoàn thành.'],
      risks: [],
    });
    expect(result.usage).toEqual({ inputTokens: 170, outputTokens: 30 });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('fails after two invalid structured responses', async () => {
    const generate = vi.fn().mockResolvedValue({
      content: '{not-json',
      usage: { inputTokens: 50, outputTokens: 5 },
    });
    const generator = new BedrockGroundedGenerator({ generate });

    await expect(
      generator.progress({
        groupId: 'group-1',
        version: 1,
        generatedAt: '2026-08-08T08:00:00.000Z',
        taskCounts: { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 },
        meetingCounts: { completed: 0, upcoming: 0 },
      }),
    ).rejects.toThrow('INVALID_MODEL_OUTPUT');
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
