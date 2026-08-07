import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { Meeting } from '@campusmeet/shared';
import { useAuth } from '../../auth/AuthProvider';
import { getMeetAddonMeetingInfo } from './meet-addon-client';
import { resolveMeetContext } from './service';
import './meet-addon.css';

type State =
  | { status: 'loading' }
  | { status: 'ready'; meeting: Meeting }
  | { status: 'unlinked'; message: string; meetingCode?: string }
  | { status: 'error'; message: string };

export function MeetSidePanelPage() {
  const auth = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    let active = true;
    void getMeetAddonMeetingInfo()
      .then(async (context) => ({ context, meeting: await resolveMeetContext(context.meetingId) }))
      .then(({ meeting }) => {
        if (active) setState({ status: 'ready', meeting });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Không thể đọc ngữ cảnh Google Meet.';
        setState({
          status: message.includes('404') ? 'unlinked' : 'error',
          message,
        });
      });
    return () => {
      active = false;
    };
  }, [auth.status]);

  if (auth.status === 'loading') return <main className="meet-addon-panel">Đang kiểm tra phiên…</main>;
  if (auth.status !== 'authenticated') {
    sessionStorage.setItem('campusmeet:returnTo', '/meet-addon/side-panel');
    return <Navigate to="/sign-in" replace />;
  }
  if (state.status === 'loading') return <main className="meet-addon-panel">Đang kết nối Google Meet…</main>;

  if (state.status === 'ready') {
    return (
      <main className="meet-addon-panel">
        <span>CampusMeet</span>
        <h1>{state.meeting.title}</h1>
        <p>Cuộc họp đã được liên kết và bạn có quyền truy cập.</p>
        <a className="meet-addon-action" href={`/app/meetings/${state.meeting.id}`} target="_blank" rel="noreferrer">
          Mở cuộc họp trên CampusMeet
        </a>
      </main>
    );
  }

  return (
    <main className="meet-addon-panel">
      <span>CampusMeet</span>
      <h1>{state.status === 'unlinked' ? 'Cuộc họp chưa được liên kết' : 'Không thể mở Add-on'}</h1>
      <p>{state.message}</p>
      <a className="meet-addon-action" href="/app/meetings" target="_blank" rel="noreferrer">
        Mở CampusMeet
      </a>
    </main>
  );
}
