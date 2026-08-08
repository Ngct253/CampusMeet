import { fetchAuthSession } from 'aws-amplify/auth';
import {
  aiJobDetailSchema,
  aiJobSchema,
  confirmTaskProposalResponseSchema,
  type AIJob,
  type AIJobDetail,
  type GenerateMeetingDraftRequest,
  type ConfirmTaskProposalRequest,
  type ConfirmTaskProposalResponse,
  type GroupKnowledgeQuery,
  type GroupProgressAnalysisRequest,
  type MeetingChatRequest,
} from '@campusmeet/shared';
import { environment } from '../../config/environment';

interface ApiEnvelope<T> {
  success: true;
  data: T;
  requestId: string;
}

interface ApiFailureEnvelope {
  success: false;
  error?: { code?: string; message?: string };
  requestId?: string;
}

export class AIServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export interface AIService {
  meetingChat(
    meetingId: string,
    request: MeetingChatRequest,
    idempotencyKey: string,
  ): Promise<AIJob>;
  groupSearch(
    groupId: string,
    request: GroupKnowledgeQuery,
    idempotencyKey: string,
  ): Promise<AIJob>;
  minutesDraft(
    meetingId: string,
    request: GenerateMeetingDraftRequest,
    idempotencyKey: string,
  ): Promise<AIJob>;
  taskProposals(
    meetingId: string,
    request: GenerateMeetingDraftRequest,
    idempotencyKey: string,
  ): Promise<AIJob>;
  confirmTaskProposal(
    proposalId: string,
    request: ConfirmTaskProposalRequest,
  ): Promise<ConfirmTaskProposalResponse>;
  progressAnalysis(
    groupId: string,
    request: GroupProgressAnalysisRequest,
    idempotencyKey: string,
  ): Promise<AIJob>;
  getJob(aiJobId: string): Promise<AIJobDetail>;
}

interface AIServiceOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  getAccessToken?: () => Promise<string | undefined>;
}

const defaultAccessToken = async () => (await fetchAuthSession()).tokens?.accessToken.toString();

const pathId = (value: string) => encodeURIComponent(value);

export const createAIService = (options: AIServiceOptions = {}): AIService => {
  const baseUrl = options.baseUrl ?? environment.apiBaseUrl;
  const fetcher = options.fetcher ?? fetch;
  const getAccessToken = options.getAccessToken ?? defaultAccessToken;

  const request = async <T>(
    path: string,
    schema: { parse(value: unknown): T },
    init: RequestInit = {},
  ): Promise<T> => {
    if (!baseUrl) {
      throw new AIServiceError(503, 'API_NOT_CONFIGURED', 'API CampusMeet chưa được cấu hình.');
    }
    const token = await getAccessToken();
    const response = await fetcher(baseUrl + path, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    const payload = (await response.json().catch(() => undefined)) as
      ApiEnvelope<unknown> | ApiFailureEnvelope | undefined;
    if (!response.ok || !payload?.success) {
      const failure = payload as ApiFailureEnvelope | undefined;
      throw new AIServiceError(
        response.status,
        failure?.error?.code ?? 'AI_REQUEST_FAILED',
        failure?.error?.message ?? 'Không thể xử lý yêu cầu AI.',
      );
    }
    return schema.parse(payload.data);
  };

  const post = (path: string, body: unknown, idempotencyKey: string) =>
    request(path, aiJobSchema, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': idempotencyKey },
    });

  return {
    meetingChat: (meetingId, body, key) =>
      post(`/meetings/${pathId(meetingId)}/ai/chat`, body, key),
    groupSearch: (groupId, body, key) => post(`/groups/${pathId(groupId)}/ai/search`, body, key),
    minutesDraft: (meetingId, body, key) =>
      post(`/meetings/${pathId(meetingId)}/ai/minutes-draft`, body, key),
    taskProposals: (meetingId, body, key) =>
      post(`/meetings/${pathId(meetingId)}/ai/task-proposals`, body, key),
    confirmTaskProposal: (proposalId, body) =>
      request(
        `/ai/task-proposals/${pathId(proposalId)}/confirm`,
        confirmTaskProposalResponseSchema,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    progressAnalysis: (groupId, body, key) =>
      post(`/groups/${pathId(groupId)}/ai/progress-analysis`, body, key),
    getJob: (aiJobId) => request(`/ai/jobs/${pathId(aiJobId)}`, aiJobDetailSchema),
  };
};

export const aiService = createAIService();

export const createAIIdempotencyKey = () => `ai-${crypto.randomUUID()}`;
