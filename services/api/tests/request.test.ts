import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { meetingChatRequestSchema } from '@campusmeet/shared';
import { parseBody, requireIdempotencyKey } from '../src/utils/request';

const event = (body?: string, headers: Record<string, string> = {}) =>
  ({ body, headers }) as APIGatewayProxyEventV2;

describe('validated API requests', () => {
  it('parses a valid body and applies schema defaults', () => {
    expect(parseBody(event(JSON.stringify({ question: 'Tóm tắt giúp tôi' })), meetingChatRequestSchema)).toEqual({
      question: 'Tóm tắt giúp tôi',
      intent: 'QUESTION_ANSWER',
    });
  });

  it('returns a safe 400 error for malformed input', () => {
    expect(() => parseBody(event('{'), meetingChatRequestSchema)).toThrow('Body phải là JSON hợp lệ.');
    expect(() => parseBody(event(JSON.stringify({ question: '' })), meetingChatRequestSchema)).toThrow(
      'Dữ liệu yêu cầu không hợp lệ.',
    );
  });

  it('requires a bounded idempotency key', () => {
    expect(requireIdempotencyKey(event(undefined, { 'idempotency-key': 'request-1' }))).toBe('request-1');
    expect(() => requireIdempotencyKey(event())).toThrow('Idempotency-Key hợp lệ là bắt buộc.');
  });
});
