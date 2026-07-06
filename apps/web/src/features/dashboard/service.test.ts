import { describe, expect, it } from 'vitest';
import { getMockDashboard } from './service';

describe('mock dashboard service', () => {
  it('marks responses as mock data', async () => {
    expect((await getMockDashboard()).isMock).toBe(true);
  });
});
