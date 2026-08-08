import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { liveConnectionInfoSchema, type LiveConnectionInfo } from '@campusmeet/shared';
import type { LiveConnectionSigner } from '../domain/live-transcription-ports';
import { ServiceConfigurationError } from '../utils/errors';

const SIGNED_CONNECTION_SECONDS = 60;
export class AmazonTranscribeConnectionSigner implements LiveConnectionSigner {
  async create(input: { languageCode: string; resumeFromSequence: number }): Promise<LiveConnectionInfo> {
    const region = process.env.AWS_REGION;
    if (!region) throw new ServiceConfigurationError('AWS_REGION is required for live transcription.');
    const host = `transcribestreaming.${region}.amazonaws.com:8443`;
    const signer = new SignatureV4({ credentials: defaultProvider(), region, service: 'transcribe', sha256: Sha256 });
    const signed = await signer.presign(new HttpRequest({
      protocol: 'wss:', hostname: host, method: 'GET', path: '/stream-transcription-websocket',
      query: {
        'language-code': input.languageCode,
        'media-encoding': 'pcm',
        'sample-rate': '16000',
        'enable-partial-results-stabilization': 'true',
        'partial-results-stability': 'medium',
        'show-speaker-label': 'true',
      },
      headers: { host },
    }), { expiresIn: SIGNED_CONNECTION_SECONDS });
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(signed.query ?? {})) {
      if (Array.isArray(value)) value.forEach((entry) => query.append(key, entry));
      else if (value !== undefined) query.set(key, String(value));
    }
    const now = Date.now();
    return liveConnectionInfoSchema.parse({
      url: `wss://${host}${signed.path}?${query.toString()}`,
      expiresAt: new Date(now + SIGNED_CONNECTION_SECONDS * 1000).toISOString(),
      mediaEncoding: 'pcm', sampleRateHertz: 16000, languageCode: input.languageCode,
      resumeFromSequence: input.resumeFromSequence,
    });
  }
}
