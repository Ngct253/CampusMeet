import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  GroupRole,
  minutesDraftSchema,
  taskProposalSchema,
  type ConfirmTaskProposalResponse,
  type GroupDetails,
} from '@campusmeet/shared';
import { AIJobState, MinutesDraftPreview, TaskProposalEditor } from './components';
import {
  useAIJob,
  useConfirmTaskProposalMutation,
  useMinutesDraftMutation,
  useTaskProposalsMutation,
} from './hooks';
import { AIServiceError, createAIIdempotencyKey } from './service';

const taskProposalListSchema = taskProposalSchema.array();

export function MeetingAIWorkspace({
  meetingId,
  group,
}: {
  meetingId: string;
  group: GroupDetails;
}) {
  const [minutesJobId, setMinutesJobId] = useState<string>();
  const [taskJobId, setTaskJobId] = useState<string>();
  const queryClient = useQueryClient();
  const [confirmedProposals, setConfirmedProposals] = useState<
    Record<string, ConfirmTaskProposalResponse>
  >({});
  const [confirmationErrors, setConfirmationErrors] = useState<Record<string, string>>({});
  const [confirmingProposalId, setConfirmingProposalId] = useState<string>();
  const minutesMutation = useMinutesDraftMutation();
  const taskMutation = useTaskProposalsMutation();
  const confirmationMutation = useConfirmTaskProposalMutation();
  const minutesJobQuery = useAIJob(minutesJobId);
  const taskJobQuery = useAIJob(taskJobId);
  const resetMinutesMutation = minutesMutation.reset;
  const resetTaskMutation = taskMutation.reset;
  const resetConfirmationMutation = confirmationMutation.reset;

  useEffect(() => {
    setMinutesJobId(undefined);
    setTaskJobId(undefined);
    setConfirmedProposals({});
    setConfirmationErrors({});
    setConfirmingProposalId(undefined);
    resetMinutesMutation();
    resetTaskMutation();
    resetConfirmationMutation();
  }, [meetingId, resetMinutesMutation, resetTaskMutation, resetConfirmationMutation]);

  const minutesResult = minutesDraftSchema.safeParse(minutesJobQuery.data?.result);
  const minutesDraft =
    minutesJobQuery.data?.type === 'GENERATE_MINUTES' &&
    minutesJobQuery.data.groupId === group.group.id &&
    minutesJobQuery.data.meetingId === meetingId &&
    minutesResult.success &&
    minutesResult.data.meetingId === meetingId
      ? minutesResult.data
      : undefined;
  const taskResult = taskProposalListSchema.safeParse(taskJobQuery.data?.result);
  const taskProposals =
    taskJobQuery.data?.type === 'GENERATE_TASK_PROPOSALS' &&
    taskJobQuery.data.groupId === group.group.id &&
    taskJobQuery.data.meetingId === meetingId &&
    taskResult.success &&
    taskResult.data.every(
      (proposal) => proposal.groupId === group.group.id && proposal.meetingId === meetingId,
    )
      ? taskResult.data
      : undefined;
  const minutesResultInvalid =
    minutesJobQuery.data?.status === 'COMPLETED' && minutesDraft === undefined;
  const taskResultInvalid =
    taskJobQuery.data?.status === 'COMPLETED' && taskProposals === undefined;
  const minutesError = minutesMutation.isError
    ? minutesMutation.error
    : minutesJobQuery.isError
      ? minutesJobQuery.error
      : minutesResultInvalid
        ? new Error('Kết quả biên bản AI không hợp lệ.')
        : null;
  const taskError = taskMutation.isError
    ? taskMutation.error
    : taskJobQuery.isError
      ? taskJobQuery.error
      : taskResultInvalid
        ? new Error('Kết quả đề xuất công việc AI không hợp lệ.')
        : null;
  const minutesIsWorking =
    minutesMutation.isPending ||
    minutesJobQuery.data?.status === 'QUEUED' ||
    minutesJobQuery.data?.status === 'PROCESSING';
  const tasksAreWorking =
    taskMutation.isPending ||
    taskJobQuery.data?.status === 'QUEUED' ||
    taskJobQuery.data?.status === 'PROCESSING';
  const assigneeOptions = group.members
    .filter(({ membership }) => membership.active !== false)
    .map(({ membership, user }) => ({
      userId: membership.userId,
      displayName: user?.displayName || user?.email || membership.userId,
    }));

  return (
    <section className="meeting-ai-workspace" aria-labelledby="meeting-ai-workspace-title">
      <div className="app-panel meeting-ai-controls">
        <div>
          <span className="section-kicker">Sau cuộc họp</span>
          <h2 id="meeting-ai-workspace-title">Biên bản và công việc AI</h2>
          <p>
            AI chỉ dùng nguồn cuộc họp đã được phép truy cập. Mọi kết quả đều là bản nháp cần con
            người kiểm tra.
          </p>
        </div>
        <div className="meeting-ai-actions">
          <button
            className="button"
            type="button"
            disabled={minutesIsWorking}
            onClick={() => {
              minutesMutation.reset();
              setMinutesJobId(undefined);
              minutesMutation.mutate(
                { meetingId, request: {}, idempotencyKey: createAIIdempotencyKey() },
                { onSuccess: (job) => setMinutesJobId(job.aiJobId) },
              );
            }}
          >
            {minutesIsWorking ? 'Đang tạo biên bản…' : 'Tạo biên bản nháp'}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={tasksAreWorking}
            onClick={() => {
              taskMutation.reset();
              setTaskJobId(undefined);
              setConfirmedProposals({});
              setConfirmationErrors({});
              taskMutation.mutate(
                { meetingId, request: {}, idempotencyKey: createAIIdempotencyKey() },
                { onSuccess: (job) => setTaskJobId(job.aiJobId) },
              );
            }}
          >
            {tasksAreWorking ? 'Đang trích xuất…' : 'Đề xuất công việc'}
          </button>
        </div>
      </div>

      {(minutesJobId || minutesError) && (
        <AIJobState
          job={minutesJobQuery.data}
          isLoading={minutesJobQuery.isLoading}
          error={minutesError}
          onRetry={() => {
            minutesMutation.reset();
            setMinutesJobId(undefined);
          }}
        >
          {minutesDraft && <MinutesDraftPreview draft={minutesDraft} />}
        </AIJobState>
      )}

      {(taskJobId || taskError) && (
        <AIJobState
          job={taskJobQuery.data}
          isLoading={taskJobQuery.isLoading}
          error={taskError}
          onRetry={() => {
            taskMutation.reset();
            setTaskJobId(undefined);
            setConfirmedProposals({});
            setConfirmationErrors({});
          }}
        >
          {taskProposals?.length === 0 && (
            <div className="ai-feedback ai-feedback--empty" role="status">
              <div>
                <strong>Chưa có công việc được nêu</strong>
                <p>AI không tìm thấy việc cần làm có đủ căn cứ trong nội dung cuộc họp.</p>
              </div>
            </div>
          )}
          {taskProposals?.map((generatedProposal) => {
            const proposal =
              confirmedProposals[generatedProposal.proposalId]?.proposal ?? generatedProposal;
            return (
              <div className="meeting-ai-proposal" key={`${taskJobId}-${proposal.proposalId}`}>
                <TaskProposalEditor
                  proposal={proposal}
                  assigneeOptions={assigneeOptions}
                  canConfirm={group.group.role === GroupRole.GROUP_ADMIN}
                  isPending={
                    confirmationMutation.isPending && confirmingProposalId === proposal.proposalId
                  }
                  error={confirmationErrors[proposal.proposalId]}
                  onConfirm={({ proposalId, request }) => {
                    if (confirmationMutation.isPending) return;
                    setConfirmingProposalId(proposalId);
                    setConfirmationErrors((current) => ({ ...current, [proposalId]: '' }));
                    confirmationMutation.mutate(
                      { proposalId, request },
                      {
                        onSuccess: async (response) => {
                          setConfirmedProposals((current) => ({
                            ...current,
                            [proposalId]: response,
                          }));
                          setConfirmingProposalId(undefined);
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ['tasks'] }),
                            queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
                          ]);
                        },
                        onError: async (error) => {
                          setConfirmingProposalId(undefined);
                          setConfirmationErrors((current) => ({
                            ...current,
                            [proposalId]:
                              error instanceof AIServiceError && error.status === 422
                                ? error.message
                                : error instanceof AIServiceError && error.status === 403
                                  ? 'Bạn không còn quyền xác nhận đề xuất này.'
                                  : 'Không thể xác nhận đề xuất công việc. Vui lòng thử lại.',
                          }));
                          if (error instanceof AIServiceError && error.status === 409) {
                            await taskJobQuery.refetch();
                          }
                        },
                      },
                    );
                  }}
                />
              </div>
            );
          })}
        </AIJobState>
      )}
    </section>
  );
}
