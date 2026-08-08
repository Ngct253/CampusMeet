import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { describe, expect, it, vi } from 'vitest';
import {
  BedrockMantleClient,
  loadBedrockMantleApiKey,
} from '../src/providers/bedrock-mantle-client';

describe('BedrockMantleClient', () => {
  it('calls the configured Mantle chat-completions endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"answer":"ok"}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
        { status: 200 },
      ),
    );
    const client = new BedrockMantleClient(
      'https://bedrock-mantle.us-east-1.api.aws/v1/',
      'openai.gpt-oss-20b',
      'test-api-key',
      fetcher,
    );

    await expect(client.generate('system', 'prompt')).resolves.toEqual({
      content: '{"answer":"ok"}',
      usage: { inputTokens: 12, outputTokens: 4 },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetcher.mock.calls[0]![1] as RequestInit;
    expect(request.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer test-api-key' }),
    );
    expect(JSON.parse(request.body as string)).toEqual(
      expect.objectContaining({
        model: 'openai.gpt-oss-20b',
        max_completion_tokens: 4_096,
      }),
    );
  });

  it('does not expose provider error bodies', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('sensitive provider detail', { status: 500 }));
    const client = new BedrockMantleClient('https://example.invalid/v1', 'model', 'key', fetcher);
    await expect(client.generate('system', 'prompt')).rejects.toThrow('MODEL_PROVIDER_ERROR');
  });

  it('classifies HTTP 429 as a safe retryable error', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('sensitive quota detail', { status: 429 }));
    const client = new BedrockMantleClient('https://example.invalid/v1', 'model', 'key', fetcher);
    await expect(client.generate('system', 'prompt')).rejects.toThrow('AI_RATE_LIMITED');
  });

  it('maps malformed success payloads to a safe provider error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"choices":[]}', { status: 200 }));
    const client = new BedrockMantleClient('https://example.invalid/v1', 'model', 'key', fetcher);
    await expect(client.generate('system', 'prompt')).rejects.toThrow('MODEL_PROVIDER_ERROR');
  });

  it('loads the apiKey field from Secrets Manager', async () => {
    const send = vi.fn().mockResolvedValue({ SecretString: '{"apiKey":"test-api-key"}' });
    await expect(
      loadBedrockMantleApiKey('secret-arn', { send } as unknown as SecretsManagerClient),
    ).resolves.toBe('test-api-key');
  });
});
