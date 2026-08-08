import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import type { GroundedModelClient } from './bedrock-grounded-generator';

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
});

export class BedrockMantleClient implements GroundedModelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly modelId: string,
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(system: string, prompt: string): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: 4_096,
        temperature: 0,
      }),
    });
    if (!response.ok) throw new Error('MODEL_PROVIDER_ERROR');
    return responseSchema.parse(await response.json()).choices[0]!.message.content;
  }
}

export const loadBedrockMantleApiKey = async (
  secretId: string,
  client = new SecretsManagerClient({}),
): Promise<string> => {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) throw new Error('AI_WORKER_CONFIGURATION_ERROR');
  try {
    const value = JSON.parse(result.SecretString) as Record<string, unknown>;
    if (typeof value.apiKey !== 'string' || !value.apiKey.trim()) throw new Error();
    return value.apiKey;
  } catch {
    throw new Error('AI_WORKER_CONFIGURATION_ERROR');
  }
};
