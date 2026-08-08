import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AIJob,
  ConfirmTaskProposalRequest,
  ConfirmTaskProposalResponse,
  GenerateMeetingDraftRequest,
  GroupKnowledgeQuery,
  GroupProgressAnalysisRequest,
  MeetingChatRequest,
} from '@campusmeet/shared';
import { aiService, type AIService } from './service';

export const aiQueryKeys = {
  job: (aiJobId: string) => ['ai', 'jobs', aiJobId] as const,
};

export interface IdempotentRequest {
  idempotencyKey: string;
}

const terminalAIJobStatuses = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export const getAIJobRefetchInterval = (status: AIJob['status'] | undefined, intervalMs: number) =>
  status && terminalAIJobStatuses.has(status) ? false : intervalMs;

export const createAIHooks = (service: AIService) => ({
  useJob(aiJobId: string | undefined, intervalMs = 2_000) {
    return useQuery({
      queryKey: aiQueryKeys.job(aiJobId ?? 'pending'),
      queryFn: () => service.getJob(aiJobId!),
      enabled: Boolean(aiJobId),
      refetchInterval: (query) => getAIJobRefetchInterval(query.state.data?.status, intervalMs),
    });
  },
  useMeetingChat() {
    return useMutation<
      AIJob,
      Error,
      IdempotentRequest & { meetingId: string; request: MeetingChatRequest }
    >({
      mutationFn: ({ meetingId, request, idempotencyKey }) =>
        service.meetingChat(meetingId, request, idempotencyKey),
    });
  },
  useGroupSearch() {
    return useMutation<
      AIJob,
      Error,
      IdempotentRequest & { groupId: string; request: GroupKnowledgeQuery }
    >({
      mutationFn: ({ groupId, request, idempotencyKey }) =>
        service.groupSearch(groupId, request, idempotencyKey),
    });
  },
  useMinutesDraft() {
    return useMutation<
      AIJob,
      Error,
      IdempotentRequest & { meetingId: string; request: GenerateMeetingDraftRequest }
    >({
      mutationFn: ({ meetingId, request, idempotencyKey }) =>
        service.minutesDraft(meetingId, request, idempotencyKey),
    });
  },
  useTaskProposals() {
    return useMutation<
      AIJob,
      Error,
      IdempotentRequest & { meetingId: string; request: GenerateMeetingDraftRequest }
    >({
      mutationFn: ({ meetingId, request, idempotencyKey }) =>
        service.taskProposals(meetingId, request, idempotencyKey),
    });
  },
  useConfirmTaskProposal() {
    const queryClient = useQueryClient();
    return useMutation<
      ConfirmTaskProposalResponse,
      Error,
      IdempotentRequest & { proposalId: string; request: ConfirmTaskProposalRequest }
    >({
      mutationFn: ({ proposalId, request, idempotencyKey }) =>
        service.confirmTaskProposal(proposalId, request, idempotencyKey),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    });
  },
  useProgressAnalysis() {
    return useMutation<
      AIJob,
      Error,
      IdempotentRequest & { groupId: string; request: GroupProgressAnalysisRequest }
    >({
      mutationFn: ({ groupId, request, idempotencyKey }) =>
        service.progressAnalysis(groupId, request, idempotencyKey),
    });
  },
});

export const {
  useJob: useAIJob,
  useMeetingChat: useMeetingChatMutation,
  useGroupSearch: useGroupSearchMutation,
  useMinutesDraft: useMinutesDraftMutation,
  useTaskProposals: useTaskProposalsMutation,
  useConfirmTaskProposal: useConfirmTaskProposalMutation,
  useProgressAnalysis: useProgressAnalysisMutation,
} = createAIHooks(aiService);
