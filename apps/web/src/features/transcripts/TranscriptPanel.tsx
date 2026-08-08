import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  GroupRole,
  type GroupDetails,
  type Meeting,
  type TranscriptSegment,
} from '@campusmeet/shared';
import { ApiClientError } from '../../lib/api-client';
import { getTranscript, updateTranscriptSegment } from './service';
import './transcript.css';

type Draft = Pick<TranscriptSegment, 'text' | 'speakerLabel' | 'languageCode'> & {
  segmentId: string;
  baseVersion: number;
};
export function TranscriptPanel({
  meeting,
  group,
  actorId,
}: {
  meeting: Meeting;
  group?: GroupDetails;
  actorId: string;
}) {
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [message, setMessage] = useState('');
  const key = ['meetings', meeting.id, 'transcripts'] as const;
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      getTranscript(meeting.id, { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const transcript = query.data?.pages[0]?.transcript;
  const segments = query.data?.pages.flatMap((page) => page.segments) ?? [];
  const membership = group?.members.find((item) => item.membership.userId === actorId)?.membership;
  const canEdit = Boolean(
    membership?.active &&
    (meeting.organizerId === actorId || membership.role === GroupRole.GROUP_ADMIN),
  );
  const mutation = useMutation({
    mutationFn: (value: Draft) =>
      updateTranscriptSegment(transcript!.transcriptId, value.segmentId, {
        expectedVersion: value.baseVersion,
        text: value.text,
        speakerLabel: value.speakerLabel,
        languageCode: value.languageCode,
      }),
    onSuccess: async () => {
      setEditing(undefined);
      setDraft(undefined);
      setMessage('Đã lưu thay đổi.');
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: async (error: Error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        setMessage(
          'Transcript đã thay đổi. Bản nháp của bạn được giữ lại; hãy kiểm tra phiên bản mới trước khi gửi lại.',
        );
        await queryClient.invalidateQueries({ queryKey: key });
      } else if (error instanceof ApiClientError && error.status === 422)
        setMessage('Không thể sửa ở trạng thái hiện tại. Bản nháp vẫn được giữ.');
      else setMessage('Không thể lưu. Bản nháp vẫn được giữ để bạn thử lại.');
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  if (query.isLoading)
    return (
      <section className="transcript-panel">
        <h2>Transcript</h2>
        <p>Đang tải transcript…</p>
      </section>
    );
  if (query.isError)
    return (
      <section className="transcript-panel">
        <h2>Transcript</h2>
        <p className="error" role="status">
          Không thể tải transcript.
        </p>
        <button onClick={() => void query.refetch()}>Thử tải lại transcript</button>
      </section>
    );
  if (!transcript)
    return (
      <section className="transcript-panel">
        <h2>Transcript</h2>
        <p>Cuộc họp chưa có transcript.</p>
      </section>
    );
  if (['LIVE', 'FINALIZING'].includes(transcript.status))
    return (
      <section className="transcript-panel">
        <h2>Transcript</h2>
        <p>Transcript đang được hoàn thiện và hiện chỉ có thể xem.</p>
      </section>
    );
  if (transcript.status === 'FAILED')
    return (
      <section className="transcript-panel">
        <h2>Transcript</h2>
        <p className="error">Không thể tạo transcript cho cuộc họp này.</p>
      </section>
    );
  return (
    <section className="transcript-panel">
      <header>
        <div>
          <h2>Transcript</h2>
          <p>
            Phiên bản {transcript.version} ·{' '}
            {transcript.status === 'APPROVED' ? 'Đã duyệt' : 'Sẵn sàng'}
          </p>
          {transcript.approvedVersion && (
            <small>Đã duyệt lịch sử ở phiên bản {transcript.approvedVersion}</small>
          )}
        </div>
      </header>
      {message && <p role="status">{message}</p>}
      {draft && transcript.version !== draft.baseVersion && (
        <button
          type="button"
          onClick={() => {
            setDraft({ ...draft, baseVersion: transcript.version });
            setMessage(`Bản nháp hiện dựa trên phiên bản ${transcript.version}.`);
          }}
        >
          Dùng phiên bản mới nhất
        </button>
      )}
      <ol className="transcript-segments">
        {segments.map((segment) => (
          <li key={segment.segmentId}>
            {editing === segment.segmentId && draft ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (submitting.current || mutation.isPending) return;
                  submitting.current = true;
                  mutation.mutate(draft);
                }}
              >
                <label>
                  Nhãn người nói
                  <input
                    value={draft.speakerLabel}
                    onChange={(e) => setDraft({ ...draft, speakerLabel: e.target.value })}
                  />
                </label>
                <label>
                  Ngôn ngữ
                  <input
                    value={draft.languageCode}
                    onChange={(e) => setDraft({ ...draft, languageCode: e.target.value })}
                  />
                </label>
                <label>
                  Nội dung
                  <textarea
                    value={draft.text}
                    onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  />
                </label>
                <button disabled={mutation.isPending}>Lưu</button>
                <button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setEditing(undefined);
                    setDraft(undefined);
                  }}
                >
                  Hủy
                </button>
              </form>
            ) : (
              <>
                <div>
                  <strong>{segment.speakerLabel}</strong>
                  <small>
                    {Math.floor(segment.startMs / 1000)}s–{Math.floor(segment.endMs / 1000)}s ·{' '}
                    {segment.languageCode}
                  </small>
                </div>
                <p>{segment.text}</p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(segment.segmentId);
                      setDraft({
                        segmentId: segment.segmentId,
                        baseVersion: transcript.version,
                        text: segment.text,
                        speakerLabel: segment.speakerLabel,
                        languageCode: segment.languageCode,
                      });
                      setMessage('');
                    }}
                  >
                    Chỉnh sửa
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </button>
      )}
    </section>
  );
}
