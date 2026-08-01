import { describe, expect, it } from 'vitest';
import { getAIJobRefetchInterval } from './hooks';

describe('AI job polling', () => {
  it.each(['QUEUED', 'PROCESSING'] as const)('continues while a job is %s', (status) => {
    expect(getAIJobRefetchInterval(status, 2_000)).toBe(2_000);
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as const)(
    'stops after a job reaches %s',
    (status) => {
      expect(getAIJobRefetchInterval(status, 2_000)).toBe(false);
    },
  );

  it('continues before the first job response arrives', () => {
    expect(getAIJobRefetchInterval(undefined, 2_000)).toBe(2_000);
  });
});
