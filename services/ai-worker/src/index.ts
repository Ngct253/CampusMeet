import { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { aiWorkerEventSchema } from '@campusmeet/shared';
import type { Handler } from 'aws-lambda';
import { BedrockGroundedGenerator } from './providers/bedrock-grounded-generator';
import {
  BedrockKnowledgeBaseIngestionGateway,
  BedrockKnowledgeRetriever,
} from './providers/bedrock-knowledge-base';
import { S3SourceObjectStore } from './providers/s3-source-object-store';
import { DynamoApprovedSourceReader } from './repositories/dynamodb-approved-source-reader';
import {
  DynamoAIJobRepository,
  DynamoConversationRepository,
  DynamoGroupProgressSnapshotReader,
  DynamoKnowledgeSourceRepository,
  DynamoTaskProposalGateway,
} from './repositories/dynamodb';
import { CampusMeetDocumentNormalizer } from './workflows/document-normalizer';
import { AIExecutionService } from './workflows/execution-service';

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error('AI_WORKER_CONFIGURATION_ERROR');
  return value;
};

export const createProductionExecutionService = () => {
  const region = process.env.AWS_REGION ?? 'ap-southeast-1';
  const aiWorkTable = required('AI_WORK_TABLE');
  const meetingDataTable = required('MEETING_DATA_TABLE');
  const taskDataTable = required('TASK_DATA_TABLE');
  const userContentBucket = required('USER_CONTENT_BUCKET');
  const knowledgeBaseId = required('BEDROCK_KNOWLEDGE_BASE_ID');
  const dataSourceId = required('BEDROCK_DATA_SOURCE_ID');
  const modelId = required('BEDROCK_GENERATION_MODEL_ID');
  const database = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return new AIExecutionService({
    jobs: new DynamoAIJobRepository(database, aiWorkTable),
    retriever: new BedrockKnowledgeRetriever(
      new BedrockAgentRuntimeClient({ region }),
      knowledgeBaseId,
    ),
    liveSources: new DynamoApprovedSourceReader(database, meetingDataTable),
    generator: new BedrockGroundedGenerator(new BedrockRuntimeClient({ region }), modelId),
    conversations: new DynamoConversationRepository(database, aiWorkTable),
    proposals: new DynamoTaskProposalGateway(database, aiWorkTable),
    progressSnapshots: new DynamoGroupProgressSnapshotReader(database, taskDataTable),
    objects: new S3SourceObjectStore(new S3Client({ region }), userContentBucket),
    knowledgeSources: new DynamoKnowledgeSourceRepository(database, aiWorkTable),
    ingestion: new BedrockKnowledgeBaseIngestionGateway(
      new BedrockAgentClient({ region }),
      knowledgeBaseId,
      dataSourceId,
    ),
    normalizer: new CampusMeetDocumentNormalizer(),
  });
};

export const handler: Handler = async (untrustedEvent) => {
  const event = aiWorkerEventSchema.parse(untrustedEvent);
  const service = createProductionExecutionService();
  console.info('AI worker started', { aiJobId: event.aiJobId, action: event.action });
  if (event.action === 'CHECK_INGESTION') {
    if (!event.ingestionJobId) throw new Error('INGESTION_JOB_ID_REQUIRED');
    return service.checkIngestion(event.aiJobId, event.ingestionJobId);
  }
  return service.execute(event.aiJobId);
};
