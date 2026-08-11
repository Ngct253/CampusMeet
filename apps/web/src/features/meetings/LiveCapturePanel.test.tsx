// @vitest-environment jsdom

import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LiveCapturePanel } from './LiveCapturePanel';
import { resamplePcm16 } from './live-capture';

afterEach(cleanup);
describe('LiveCapturePanel', () => {
  it('does not expose capture mutation to an ordinary member', () => {
    const { container } = render(createElement(LiveCapturePanel, { meetingId: 'meeting-1', canControl: false }));
    expect(container.childElementCount).toBe(0);
  });
  it('defaults explicit language to vi-VN and requires a user click', () => {
    render(createElement(LiveCapturePanel, { meetingId: 'meeting-1', canControl: true }));
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('vi-VN');
    expect((screen.getByRole('button', { name: /consent and start capture/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(navigator.mediaDevices).toBeUndefined();
  });
  it('converts browser floating point audio to 16 kHz signed PCM', () => {
    const samples = new Float32Array(48_000).fill(0.5);
    const output = resamplePcm16(samples, 48_000);
    expect(output.byteLength).toBe(32_000);
    expect(new Int16Array(output.buffer)[0]).toBeGreaterThan(16_000);
  });
});
