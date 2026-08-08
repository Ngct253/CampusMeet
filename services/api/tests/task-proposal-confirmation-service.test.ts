import { GroupRole, Priority, type TaskProposal } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { TaskProposalConfirmationService } from '../src/services/task-proposal-confirmation-service';

const citation = {
  citationId: 'citation-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceType: 'TRANSCRIPT' as const,
  sourceId: 'transcript-1',
  sourceVersion: 1,
  internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1',
};

const proposal: TaskProposal = {
  proposalId: 'proposal-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  title: 'Proposed title',
  assigneeId: 'member-1',
  priority: 'MEDIUM',
  dueAt: '2026-08-20T00:00:00.000Z',
  missingFields: [],
  citations: [citation],
  status: 'PENDING',
};

const response = {
  task: {
    id: 'task-1',
    groupId: 'group-1',
    title: 'Final title',
    assigneeId: 'member-2',
    status: 'TODO' as const,
    priority: 'HIGH' as const,
    dueAt: '2026-08-21T00:00:00.000Z',
    sourceMeetingId: 'meeting-1',
    createdBy: 'admin-1',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    version: 1 as const,
  },
  proposal: {
    ...proposal,
    title: 'Final title',
    assigneeId: 'member-2',
    priority: 'HIGH' as const,
    dueAt: '2026-08-21T00:00:00.000Z',
    status: 'CONFIRMED' as const,
    confirmedTaskId: 'task-1',
  },
};

const dependencies = () => {
  const proposals = {
    getById: vi.fn().mockResolvedValue(proposal),
    getConfirmed: vi.fn().mockResolvedValue(response),
    confirm: vi.fn().mockResolvedValue(response),
  };
  const meetings = { getById: vi.fn().mockResolvedValue({ id: 'meeting-1', groupId: 'group-1' }) };
  const groups = {
    getMembership: vi
      .fn()
      .mockImplementation((_groupId: string, userId: string) =>
        Promise.resolve(
          userId === 'admin-1'
            ? { active: true, role: GroupRole.GROUP_ADMIN }
            : userId.startsWith('member-')
              ? { active: true, role: GroupRole.MEMBER }
              : null,
        ),
      ),
  };
  return { proposals, meetings, groups };
};

describe('TaskProposalConfirmationService', () => {
  it('maps allowed overrides and trusted proposal context into one confirmation write', async () => {
    const deps = dependencies();
    const service = new TaskProposalConfirmationService(deps.proposals, deps.meetings, deps.groups);

    await expect(
      service.confirm('admin-1', 'proposal-1', {
        title: 'Final title',
        assigneeId: 'member-2',
        priority: Priority.HIGH,
        dueAt: '2026-08-21T00:00:00.000Z',
      }),
    ).resolves.toEqual(response);
    expect(deps.proposals.confirm).toHaveBeenCalledWith({
      actorId: 'admin-1',
      proposal,
      input: {
        title: 'Final title',
        assigneeId: 'member-2',
        priority: 'HIGH',
        dueAt: '2026-08-21T00:00:00.000Z',
      },
    });
    expect(deps.groups.getMembership).toHaveBeenCalledWith('group-1', 'member-2');
  });

  it('uses proposal values when optional overrides are omitted', async () => {
    const deps = dependencies();
    await new TaskProposalConfirmationService(deps.proposals, deps.meetings, deps.groups).confirm(
      'admin-1',
      'proposal-1',
      {},
    );

    expect(deps.proposals.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          title: 'Proposed title',
          assigneeId: 'member-1',
          priority: 'MEDIUM',
          dueAt: '2026-08-20T00:00:00.000Z',
        },
      }),
    );
  });

  it('returns 404 for an unknown proposal before authorization', async () => {
    const deps = dependencies();
    deps.proposals.getById.mockResolvedValue(null);
    await expect(
      new TaskProposalConfirmationService(deps.proposals, deps.meetings, deps.groups).confirm(
        'admin-1',
        'missing',
        {},
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(deps.groups.getMembership).not.toHaveBeenCalled();
  });

  it.each([
    ['regular member', { active: true, role: GroupRole.MEMBER }],
    ['inactive admin', { active: false, role: GroupRole.GROUP_ADMIN }],
    ['outsider', null],
  ])('rejects a %s without writing', async (_label, membership) => {
    const deps = dependencies();
    deps.groups.getMembership.mockResolvedValueOnce(membership);
    await expect(
      new TaskProposalConfirmationService(deps.proposals, deps.meetings, deps.groups).confirm(
        'actor-1',
        'proposal-1',
        {},
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(deps.proposals.confirm).not.toHaveBeenCalled();
  });

  it('rejects a missing or cross-group source meeting as persisted data corruption', async () => {
    const deps = dependencies();
    deps.meetings.getById.mockResolvedValue({ id: 'meeting-1', groupId: 'group-2' });
    await expect(
      new TaskProposalConfirmationService(deps.proposals, deps.meetings, deps.groups).confirm(
        'admin-1',
        'proposal-1',
        {},
      ),
    ).rejects.toThrow('TASK_PROPOSAL_DATA_INTEGRITY');
    expect(deps.proposals.confirm).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive assignees with 422 and leaves the proposal pending', async () => {
    const deps = dependencies();
    deps.proposals.getById.mockResolvedValue({
      ...proposal,
      assigneeId: undefined,
      priority: undefined,
      missingFields: ['assigneeId', 'priority'],
    });
    const service = new TaskProposalConfirmationService(deps.proposals, deps.meetings, deps.groups);
    await expect(service.confirm('admin-1', 'proposal-1', {})).rejects.toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      statusCode: 422,
    });
    deps.proposals.getById.mockResolvedValue(proposal);
    deps.groups.getMembership.mockResolvedValueOnce({ active: true, role: GroupRole.GROUP_ADMIN });
    deps.groups.getMembership.mockResolvedValueOnce(null);
    await expect(service.confirm('admin-1', 'proposal-1', {})).rejects.toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      statusCode: 422,
    });
    expect(deps.proposals.confirm).not.toHaveBeenCalled();
  });

  it('idempotently resolves an already confirmed proposal and rejects REJECTED', async () => {
    const deps = dependencies();
    const service = new TaskProposalConfirmationService(deps.proposals, deps.meetings, deps.groups);
    deps.proposals.getById.mockResolvedValue(response.proposal);
    await expect(service.confirm('admin-1', 'proposal-1', {})).resolves.toEqual(response);
    expect(deps.proposals.getConfirmed).toHaveBeenCalledWith(response.proposal);
    expect(deps.proposals.confirm).not.toHaveBeenCalled();

    deps.proposals.getById.mockResolvedValue({ ...proposal, status: 'REJECTED' });
    await expect(service.confirm('admin-1', 'proposal-1', {})).rejects.toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      statusCode: 422,
    });
  });
});
