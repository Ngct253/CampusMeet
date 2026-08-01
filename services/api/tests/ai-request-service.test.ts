import type { AIJob, AIRequestPayload } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { AIRequestService } from '../src/ai/request-service';
import type { AIJobOrchestrator, MeetingScopeReader, MembershipAuthorizer } from '../src/ai/ports';

const queuedJob: AIJob = {
  aiJobId: 'aij-1',
  groupId: 'group-1',
  type: 'GENERATE_ANSWER',
  status: 'QUEUED',
  attempt: 0,
  requestId: 'request-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const setup = () => {
  const access: MembershipAuthorizer = {
    requireMember: vi.fn().mockResolvedValue(undefined),
    requireGroupAdmin: vi.fn().mockResolvedValue(undefined),
    requireMeetingOrganizerOrAdmin: vi.fn().mockResolvedValue('group-1'),
  };
  const meetings: MeetingScopeReader = {
    getMeetingGroupId: vi.fn().mockResolvedValue('group-1'),
    requireMeetingsInGroup: vi.fn().mockResolvedValue(undefined),
  };
  const jobs: AIJobOrchestrator = { enqueue: vi.fn().mockResolvedValue(queuedJob) };
  return { access, meetings, jobs, service: new AIRequestService(access, meetings, jobs) };
};

describe('AI request service', () => {
  it('authorizes a meeting chat before creating a scoped job', async () => {
    const { access, jobs, service } = setup();

    await service.requestMeetingChat({
      actorId: 'user-1',
      meetingId: 'meeting-1',
      request: { question: 'Đã thống nhất điều gì?', intent: 'QUESTION_ANSWER' },
      idempotencyKey: 'idem-1',
      requestId: 'request-1',
    });

    expect(access.requireMember).toHaveBeenCalledWith('user-1', 'group-1');
    const payload = vi.mocked(jobs.enqueue).mock.calls[0]?.[0].payload as AIRequestPayload;
    expect(payload).toMatchObject({ operation: 'MEETING_CHAT', groupId: 'group-1', meetingId: 'meeting-1' });
  });

  it('validates every selected meeting before enqueuing group search', async () => {
    const { meetings, jobs, service } = setup();

    await service.requestGroupSearch({
      actorId: 'user-1',
      groupId: 'group-1',
      request: {
        question: 'Tìm quyết định',
        scope: 'SELECTED_MEETINGS',
        meetingIds: ['meeting-1', 'meeting-2'],
      },
      idempotencyKey: 'idem-2',
      requestId: 'request-2',
    });

    expect(meetings.requireMeetingsInGroup).toHaveBeenCalledWith(
      ['meeting-1', 'meeting-2'],
      'group-1',
    );
    expect(jobs.enqueue).toHaveBeenCalledOnce();
  });

  it('requires Group Admin before progress analysis', async () => {
    const { access, service } = setup();

    await service.requestProgressAnalysis({
      actorId: 'admin-1',
      groupId: 'group-1',
      request: {},
      idempotencyKey: 'idem-3',
      requestId: 'request-3',
    });

    expect(access.requireGroupAdmin).toHaveBeenCalledWith('admin-1', 'group-1');
  });
});
