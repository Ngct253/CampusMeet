import { createHash } from 'node:crypto';
import {
  BedrockAgentClient,
  GetIngestionJobCommand,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type RetrievalFilter,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type {
  KnowledgeBaseIngestionGateway,
  KnowledgeRetriever,
  RetrievalRequest,
  SourceChunk,
} from '../domain/ports';

const equals = (key: string, value: string | boolean): RetrievalFilter => ({
  equals: { key, value },
});

const buildFilter = (request: RetrievalRequest): RetrievalFilter => {
  const filters: RetrievalFilter[] = [
    equals('groupId', request.groupId),
    equals('approved', true),
    equals('ingestionStatus', request.ingestionStatus),
    {
      in: { key: 'sourceType', value: request.sourceTypes },
    },
  ];
  if (request.meetingIds?.length)
    filters.push({ in: { key: 'meetingId', value: request.meetingIds } });
  return { andAll: filters };
};

const stringMetadata = (metadata: Record<string, unknown> | undefined, key: string): string => {
  const value = metadata?.[key];
  if (typeof value !== 'string' || !value) throw new Error('INVALID_RETRIEVAL_METADATA');
  return value;
};

export class BedrockKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly client: BedrockAgentRuntimeClient,
    private readonly knowledgeBaseId: string,
  ) {}

  async retrieve(request: RetrievalRequest): Promise<SourceChunk[]> {
    const response = await this.client.send(
      new RetrieveCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        retrievalQuery: { text: request.question },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 20,
            filter: buildFilter(request),
          },
        },
      }),
    );
    return (response.retrievalResults ?? []).map((result, index) => {
      const metadata = result.metadata;
      const groupId = stringMetadata(metadata, 'groupId');
      const meetingId = stringMetadata(metadata, 'meetingId');
      const sourceType = stringMetadata(
        metadata,
        'sourceType',
      ) as SourceChunk['citation']['sourceType'];
      const sourceId = stringMetadata(metadata, 'sourceId');
      const version = Number(metadata?.version);
      if (!Number.isInteger(version) || version < 1) throw new Error('INVALID_RETRIEVAL_METADATA');
      return {
        text: result.content?.text ?? '',
        citation: {
          citationId: `kb-${sourceId}-v${version}-${index}`,
          groupId,
          meetingId,
          sourceType,
          sourceId,
          sourceVersion: version,
          excerpt: result.content?.text?.slice(0, 500),
          internalUri: `campusmeet://meetings/${meetingId}/sources/${sourceId}?version=${version}`,
        },
        provenance: {
          kind: 'INDEXED',
          approved: metadata?.approved === true,
          ingestionStatus: metadata?.ingestionStatus === 'READY' ? 'READY' : 'FAILED',
        },
      };
    });
  }
}

export class BedrockKnowledgeBaseIngestionGateway implements KnowledgeBaseIngestionGateway {
  constructor(
    private readonly client: BedrockAgentClient,
    private readonly knowledgeBaseId: string,
    private readonly dataSourceId: string,
  ) {}

  async start(clientToken: string): Promise<string> {
    const normalizedClientToken =
      clientToken.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'job';
    const bedrockClientToken =
      normalizedClientToken.length >= 33
        ? normalizedClientToken.slice(0, 256)
        : `${normalizedClientToken}-${createHash('sha256').update(clientToken).digest('hex')}`.slice(
            0,
            33,
          );
    const response = await this.client.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        clientToken: bedrockClientToken,
      }),
    );
    const id = response.ingestionJob?.ingestionJobId;
    if (!id) throw new Error('INGESTION_START_FAILED');
    return id;
  }

  async status(ingestionJobId: string) {
    const response = await this.client.send(
      new GetIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        ingestionJobId,
      }),
    );
    switch (response.ingestionJob?.status) {
      case 'COMPLETE':
        return 'COMPLETE' as const;
      case 'FAILED':
      case 'STOPPED':
        return 'FAILED' as const;
      case 'IN_PROGRESS':
        return 'IN_PROGRESS' as const;
      default:
        return 'STARTING' as const;
    }
  }
}
