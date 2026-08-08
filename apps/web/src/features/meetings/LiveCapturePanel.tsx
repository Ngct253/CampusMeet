import { createElement, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { DEFAULT_LIVE_LANGUAGE_CODE } from '@campusmeet/shared';
import { LiveCaptureController, type CaptureUiState } from './live-capture';

export function LiveCapturePanel({ meetingId, canControl }: { meetingId: string; canControl: boolean }) {
  const [state, setState] = useState<CaptureUiState>('IDLE');
  const [error, setError] = useState('');
  const [languageCode, setLanguageCode] = useState<string>(DEFAULT_LIVE_LANGUAGE_CODE);
  const controller = useRef<LiveCaptureController | undefined>(undefined);
  useEffect(() => () => { void controller.current?.fail('PAGE_CLOSED'); }, []);
  if (!canControl) return null;
  const start = async () => {
    setError(''); controller.current = new LiveCaptureController(meetingId, setState);
    try { await controller.current.start(languageCode); }
    catch (reason) { setState('FAILED'); setError(reason instanceof Error ? reason.message : 'Live capture failed.'); }
  };
  const stop = async () => {
    try { await controller.current?.stop(); }
    catch (reason) { setState('FAILED'); setError(reason instanceof Error ? reason.message : 'Finalization failed.'); }
  };
  const startControls = state === 'IDLE' || state === 'FAILED'
    ? createElement('div', null,
        createElement('label', null, 'Language ', createElement('select', { value: languageCode, onChange: (event: ChangeEvent<HTMLSelectElement>) => setLanguageCode(event.target.value) },
          createElement('option', { value: 'vi-VN' }, 'Vietnamese'),
          createElement('option', { value: 'en-US' }, 'English'))),
        createElement('button', { type: 'button', onClick: () => void start() }, 'Consent and start capture'))
    : null;
  const stopControl = ['CONNECTING', 'LIVE', 'RECONNECTING'].includes(state)
    ? createElement('button', { type: 'button', onClick: () => void stop() }, 'Stop and finalize') : null;
  return createElement('section', { className: 'app-panel', 'aria-label': 'Live transcription' },
    createElement('h2', null, 'Live transcription'),
    createElement('p', null, 'Status: ', createElement('strong', null, state)),
    startControls, stopControl,
    error ? createElement('p', { role: 'alert', className: 'error' }, error) : null);
}
