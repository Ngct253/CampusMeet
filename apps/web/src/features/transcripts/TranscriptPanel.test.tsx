// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import {
  GroupRole,
  type ApproveTranscriptResponse,
  type GroupDetails,
  type Meeting,
  type TranscriptStatus,
  type TranscriptWithSegments,
} from '@campusmeet/shared';
import { ApiClientError } from '../../lib/api-client';
import { TranscriptPanel } from './TranscriptPanel';

const mocks = vi.hoisted(() => ({
  approveTranscript: vi.fn(),
  getTranscript: vi.fn(),
  updateTranscriptSegment: vi.fn(),
}));
vi.mock('./service', () => mocks);
const meeting = { id: 'meeting-1', groupId: 'group-1', organizerId: 'organizer-1' } as Meeting;
const group = {
  members: [
    {
      membership: {
        id: 'm',
        groupId: 'group-1',
        userId: 'organizer-1',
        role: GroupRole.MEMBER,
        active: true,
        joinedAt: '2026-01-01T00:00:00Z',
      },
    },
  ],
} as GroupDetails;
const response = (version: number, status: TranscriptStatus = 'READY'): TranscriptWithSegments => ({
  transcript: {
    transcriptId: 'tx',
    meetingId: 'meeting-1',
    groupId: 'group-1',
    status,
    version,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(status === 'APPROVED'
      ? { approvedVersion: version, approvedBy: 'user-x', approvedAt: '2026-01-01T00:00:00.000Z' }
      : {}),
  },
  segments: [
    {
      segmentId: 'seg',
      transcriptId: 'tx',
      sequence: 1,
      startMs: 0,
      endMs: 100,
      text: 'Original',
      confidence: 0.9,
      languageCode: 'vi-VN',
      speakerLabel: 'Speaker 1',
      isFinal: true,
      version,
    },
  ],
});
const approvalResponse = (version: number): ApproveTranscriptResponse => ({
  transcript: response(version, 'APPROVED').transcript!,
  aiJob: {
    aiJobId: 'ai-job-1',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    sourceId: 'tx',
    type: 'INGEST_SOURCE',
    status: 'QUEUED',
    attempt: 0,
    requestId: 'request-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
});
const renderPanel = (customGroup = group, actorId = 'organizer-1') => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TranscriptPanel meeting={meeting} group={customGroup} actorId={actorId} />
    </QueryClientProvider>,
  );
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it.each([
  ['ordinary active member', GroupRole.MEMBER, 'member-1', true, false],
  ['active Organizer', GroupRole.MEMBER, 'organizer-1', true, true],
  ['active GROUP_ADMIN', GroupRole.GROUP_ADMIN, 'admin-1', true, true],
  ['inactive Organizer', GroupRole.MEMBER, 'organizer-1', false, false],
] as const)(
  '%s edit and approval visibility',
  async (_label, role, actorId, active, authorized) => {
    mocks.getTranscript.mockResolvedValue(response(1));
    const custom = {
      members: [
        {
          membership: {
            id: 'm',
            groupId: 'group-1',
            userId: actorId,
            role,
            active,
            joinedAt: '2026-01-01T00:00:00Z',
          },
        },
      ],
    } as GroupDetails;
    renderPanel(custom, actorId);
    expect(await screen.findByText('Original')).toBeInTheDocument();
    const edit = screen.queryByRole('button', { name: 'Chỉnh sửa' });
    const approve = screen.queryByRole('button', { name: 'Duyệt transcript' });
    if (authorized) {
      expect(edit).toBeInTheDocument();
      expect(approve).toBeInTheDocument();
    } else {
      expect(edit).not.toBeInTheDocument();
      expect(approve).not.toBeInTheDocument();
    }
  },
);

it('sends the current version and one idempotency key, blocks double submit, and renders success', async () => {
  mocks.getTranscript.mockResolvedValueOnce(response(3)).mockResolvedValue(response(3, 'APPROVED'));
  let resolveApproval!: (value: ApproveTranscriptResponse) => void;
  mocks.approveTranscript.mockReturnValue(
    new Promise((resolve) => {
      resolveApproval = resolve;
    }),
  );
  renderPanel();
  const approve = await screen.findByRole('button', { name: 'Duyệt transcript' });
  fireEvent.click(approve);
  fireEvent.click(approve);
  await waitFor(() => expect(mocks.approveTranscript).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Đang duyệt…' })).toBeDisabled();
  expect(mocks.approveTranscript).toHaveBeenCalledWith(
    'tx',
    { expectedVersion: 3 },
    expect.any(String),
  );
  expect(mocks.approveTranscript.mock.calls[0]![2]).not.toHaveLength(0);

  resolveApproval(approvalResponse(3));
  expect(await screen.findByText(/Phiên bản 3 · Đã duyệt/)).toBeInTheDocument();
  await waitFor(() => expect(mocks.getTranscript).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'Duyệt transcript' })).not.toBeInTheDocument();
});

it.each([
  ['network failure', new Error('network')],
  ['server failure', new ApiClientError('server', 500, 'INTERNAL_ERROR')],
] as const)('%s permits a retry with the same idempotency key', async (_label, failure) => {
  mocks.getTranscript.mockResolvedValue(response(6));
  mocks.approveTranscript.mockRejectedValueOnce(failure).mockResolvedValueOnce(approvalResponse(6));
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Duyệt transcript' }));
  expect(
    await screen.findByText('Không thể duyệt transcript. Bạn có thể thử lại an toàn.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt transcript' }));
  await waitFor(() => expect(mocks.approveTranscript).toHaveBeenCalledTimes(2));
  expect(mocks.approveTranscript.mock.calls[1]![2]).toBe(mocks.approveTranscript.mock.calls[0]![2]);
});

it('refetches after a conflict and creates a new key for the newly observed version', async () => {
  mocks.getTranscript.mockResolvedValueOnce(response(8)).mockResolvedValue(response(9));
  mocks.approveTranscript
    .mockRejectedValueOnce(new ApiClientError('conflict', 409, 'CONFLICT'))
    .mockRejectedValueOnce(new Error('stop'));
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Duyệt transcript' }));
  expect(
    await screen.findByText(/Transcript đã thay đổi hoặc vừa được duyệt ở nơi khác/),
  ).toBeInTheDocument();
  await waitFor(() => expect(mocks.getTranscript).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Phiên bản 9 · Sẵn sàng/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Duyệt transcript' }));
  await waitFor(() => expect(mocks.approveTranscript).toHaveBeenCalledTimes(2));
  expect(mocks.approveTranscript.mock.calls[1]![1]).toEqual({ expectedVersion: 9 });
  expect(mocks.approveTranscript.mock.calls[1]![2]).not.toBe(
    mocks.approveTranscript.mock.calls[0]![2],
  );
});
it('successful edit sends its original base version and blocks double submit', async () => {
  mocks.getTranscript.mockResolvedValue(response(3));
  let resolve!: (value: unknown) => void;
  mocks.updateTranscriptSegment.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));
  fireEvent.change(screen.getByLabelText('Nội dung'), { target: { value: 'Changed' } });
  const save = screen.getByRole('button', { name: 'Lưu' });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(mocks.updateTranscriptSegment).toHaveBeenCalledTimes(1));
  expect(mocks.updateTranscriptSegment.mock.calls[0]![2]).toMatchObject({
    expectedVersion: 3,
    text: 'Changed',
  });
  resolve({ transcript: response(4).transcript, segment: response(4).segments[0] });
  await waitFor(() => expect(screen.queryByDisplayValue('Changed')).not.toBeInTheDocument());
});
it('loads the next page using nextCursor', async () => {
  mocks.getTranscript
    .mockResolvedValueOnce({ ...response(1), nextCursor: 'next-page' })
    .mockResolvedValueOnce({
      ...response(1),
      segments: [{ ...response(1).segments[0]!, segmentId: 'seg-2', sequence: 2, text: 'Second' }],
    });
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm' }));
  expect(await screen.findByText('Second')).toBeInTheDocument();
  expect(mocks.getTranscript).toHaveBeenLastCalledWith('meeting-1', {
    limit: 50,
    cursor: 'next-page',
  });
});
it.each(['LIVE', 'FINALIZING', 'FAILED'] as const)(
  '%s is read-only and has no approval action',
  async (status) => {
    mocks.getTranscript.mockResolvedValue(response(1, status));
    renderPanel();
    await screen.findByRole('heading', { name: 'Transcript' });
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /duyệt/i })).not.toBeInTheDocument();
  },
);
it('shows approved state without approval action and keeps historical edit behavior', async () => {
  mocks.getTranscript.mockResolvedValue(response(4, 'APPROVED'));
  renderPanel();
  expect(await screen.findByText(/Phiên bản 4 · Đã duyệt/)).toBeInTheDocument();
  expect(screen.getByText('Đã duyệt lịch sử ở phiên bản 4')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Duyệt transcript' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chỉnh sửa' })).toBeInTheDocument();
});
it('keeps a conflicted draft on its old base version until explicitly adopting latest', async () => {
  mocks.getTranscript.mockResolvedValueOnce(response(4)).mockResolvedValue(response(5));
  mocks.updateTranscriptSegment
    .mockRejectedValueOnce(new ApiClientError('conflict', 409, 'CONFLICT'))
    .mockRejectedValueOnce(new ApiClientError('conflict', 409, 'CONFLICT'))
    .mockResolvedValueOnce({
      transcript: response(6).transcript,
      segment: response(6).segments[0],
    });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TranscriptPanel meeting={meeting} group={group} actorId="organizer-1" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));
  fireEvent.change(screen.getByLabelText('Nội dung'), { target: { value: 'My complete draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(mocks.getTranscript).toHaveBeenCalledTimes(2));
  expect(screen.getByDisplayValue('My complete draft')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(mocks.updateTranscriptSegment).toHaveBeenCalledTimes(2));
  expect(mocks.updateTranscriptSegment.mock.calls[1]![2]).toMatchObject({
    expectedVersion: 4,
    text: 'My complete draft',
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Dùng phiên bản mới nhất' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(mocks.updateTranscriptSegment).toHaveBeenCalledTimes(3));
  expect(mocks.updateTranscriptSegment.mock.calls[2]![2]).toMatchObject({
    expectedVersion: 5,
    text: 'My complete draft',
  });
});
