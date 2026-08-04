import type { AIJob, KnowledgeIngestionPayload } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionDependencies } from '../src/workflows/execution-service';
import { AIExecutionService } from '../src/workflows/execution-service';

const payload: KnowledgeIngestionPayload = {
  operation: 'INGEST_SOURCE',
  actorId: 'user-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceId: 'source-1',
  sourceType: 'ATTACHMENT',
  sourceVersion: 1,
  approved: true,
  inputObjectKey: 'uploads/group-1/meeting-1/source-1.txt',
  contentType: 'text/plain',
};
const job: AIJob = {
  aiJobId: 'job-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceId: 'source-1',
  type: 'INGEST_SOURCE',
  status: 'PROCESSING',
  attempt: 1,
  requestId: 'request-1',
  provider: 'BEDROCK',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const setup = (status: 'COMPLETE' | 'FAILED' | 'IN_PROGRESS') => {
  const dependencies = {
    jobs: {
      get: vi.fn().mockResolvedValue({ job, payload }),
      markProcessing: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
    },
    knowledgeSources: {
      saveVersion: vi.fn(),
      markOlderVersionsStale: vi.fn().mockResolvedValue([]),
      markIngestionStatus: vi.fn(),
    },
    ingestion: { start: vi.fn(), status: vi.fn().mockResolvedValue(status) },
    retriever: { retrieve: vi.fn() },
    liveSources: { getFinalLiveSegments: vi.fn() },
    generator: {
      answer: vi.fn(),
      minutes: vi.fn(),
      taskProposals: vi.fn(),
      progress: vi.fn(),
    },
    conversations: { saveExchange: vi.fn() },
    proposals: { save: vi.fn() },
    progressSnapshots: { get: vi.fn() },
    objects: { read: vi.fn(), writeNormalized: vi.fn(), deleteNormalized: vi.fn() },
    normalizer: { normalize: vi.fn() },
  } satisfies ExecutionDependencies;
  return { dependencies, service: new AIExecutionService(dependencies) };
};

describe('knowledge base ingestion lifecycle', () => {
  it('removes stale normalized versions before starting the next ingestion', async () => {
    const { dependencies, service } = setup('IN_PROGRESS');
    dependencies.jobs.get.mockResolvedValue({
      job: { ...job, status: 'QUEUED' },
      payload: { ...payload, sourceVersion: 2 },
    });
    dependencies.objects.read.mockResolvedValue(new TextEncoder().encode('source'));
    dependencies.normalizer.normalize.mockResolvedValue('normalized source');
    dependencies.knowledgeSources.markOlderVersionsStale.mockResolvedValue([
      'kb/group-1/meeting-1/source-1/v1/content.txt',
    ]);
    dependencies.ingestion.start.mockResolvedValue('ingestion-2');

    await expect(service.execute('job-1')).resolves.toMatchObject({
      pending: true,
      ingestionJobId: 'ingestion-2',
    });

    expect(dependencies.objects.deleteNormalized).toHaveBeenCalledWith(
      'kb/group-1/meeting-1/source-1/v1/content.txt',
    );
    expect(dependencies.objects.deleteNormalized.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.ingestion.start.mock.invocationCallOrder[0]!,
    );
  });

  it('marks the source READY only after Bedrock completes ingestion', async () => {
    const { dependencies, service } = setup('COMPLETE');

    await service.checkIngestion('job-1', 'ingestion-1');

    expect(dependencies.knowledgeSources.markIngestionStatus).toHaveBeenCalledWith(
      'source-1',
      1,
      'READY',
    );
    expect(dependencies.jobs.markCompleted).toHaveBeenCalledOnce();
  });

  it('marks both source and job failed when Bedrock ingestion fails', async () => {
    const { dependencies, service } = setup('FAILED');

    await expect(service.checkIngestion('job-1', 'ingestion-1')).rejects.toThrow(
      'KNOWLEDGE_BASE_INGESTION_FAILED',
    );

    expect(dependencies.knowledgeSources.markIngestionStatus).toHaveBeenCalledWith(
      'source-1',
      1,
      'FAILED',
    );
    expect(dependencies.jobs.markFailed).toHaveBeenCalledWith(
      'job-1',
      'KNOWLEDGE_BASE_INGESTION_FAILED',
    );
  });

  it('does not finalize persistence while ingestion is still running', async () => {
    const { dependencies, service } = setup('IN_PROGRESS');

    await expect(service.checkIngestion('job-1', 'ingestion-1')).resolves.toMatchObject({
      pending: true,
      status: 'IN_PROGRESS',
    });
    expect(dependencies.knowledgeSources.markIngestionStatus).not.toHaveBeenCalled();
    expect(dependencies.jobs.markCompleted).not.toHaveBeenCalled();
  });
});
