import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupRole, Priority, TaskStatus, type Task, type TaskProposal } from '@campusmeet/shared';

const requireGroupMembership = vi.hoisted(() => vi.fn());
vi.mock('../src/middleware/authorization', () => ({ requireGroupMembership }));

import { TaskProposalConfirmationService } from '../src/services/task-proposal-confirmation-service';

const proposal: TaskProposal = {
  proposalId: 'proposal-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  title: 'Hoàn thiện bản demo',
  missingFields: ['assigneeId', 'priority'],
  citations: [
    {
      citationId: 'citation-1',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      sourceType: 'TRANSCRIPT',
      sourceId: 'transcript-1',
      sourceVersion: 1,
      internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1',
    },
  ],
  status: 'PENDING',
};

const task: Task = {
  id: 'task-1',
  groupId: 'group-1',
  title: proposal.title,
  assigneeId: 'user-1',
  priority: Priority.HIGH,
  status: TaskStatus.TODO,
  sourceMeetingId: 'meeting-1',
};

const dependencies = () => {
  const proposals = {
    getById: vi.fn().mockResolvedValue(proposal),
    claim: vi.fn().mockResolvedValue({ ...proposal, status: 'CONFIRMED' }),
    markExecuted: vi
      .fn()
      .mockResolvedValue({ ...proposal, status: 'EXECUTED', taskId: task.id }),
  };
  const taskService = { createTask: vi.fn().mockResolvedValue(task) };
  const tasks = { getById: vi.fn().mockResolvedValue(task) };
  return { proposals, taskService, tasks };
};

describe('TaskProposalConfirmationService', () => {
  beforeEach(() => requireGroupMembership.mockReset().mockResolvedValue({ active: true }));

  it('re-authorizes, claims the proposal, and creates one task through the standard service', async () => {
    const { proposals, taskService, tasks } = dependencies();
    const result = await new TaskProposalConfirmationService(
      proposals,
      taskService,
      tasks,
    ).confirm(
      'admin-1',
      proposal.proposalId,
      { assigneeId: 'user-1', priority: Priority.HIGH },
      'confirm-key',
    );

    expect(requireGroupMembership).toHaveBeenCalledWith(
      'admin-1',
      'group-1',
      GroupRole.GROUP_ADMIN,
    );
    expect(proposals.claim).toHaveBeenCalledWith(
      proposal.proposalId,
      'admin-1',
      'confirm-key',
    );
    expect(requireGroupMembership.mock.invocationCallOrder[0]).toBeLessThan(
      proposals.claim.mock.invocationCallOrder[0]!,
    );
    expect(taskService.createTask).toHaveBeenCalledWith(
      'admin-1',
      {
        groupId: 'group-1',
        title: proposal.title,
        assigneeId: 'user-1',
        priority: Priority.HIGH,
        sourceMeetingId: 'meeting-1',
      },
      `ai-task-proposal:${proposal.proposalId}`,
    );
    expect(proposals.markExecuted).toHaveBeenCalledWith(
      proposal.proposalId,
      'admin-1',
      'confirm-key',
      task.id,
    );
    expect(result).toEqual({
      proposal: { ...proposal, status: 'EXECUTED', taskId: task.id },
      task,
    });
  });

  it('returns the linked task without creating another one when confirmation is replayed', async () => {
    const { proposals, taskService, tasks } = dependencies();
    proposals.getById.mockResolvedValue({ ...proposal, status: 'EXECUTED', taskId: task.id });

    const result = await new TaskProposalConfirmationService(
      proposals,
      taskService,
      tasks,
    ).confirm(
      'admin-1',
      proposal.proposalId,
      { assigneeId: 'user-1', priority: Priority.HIGH },
      'another-key',
    );

    expect(tasks.getById).toHaveBeenCalledWith(task.id);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(proposals.claim).not.toHaveBeenCalled();
    expect(result.task).toEqual(task);
  });

});
