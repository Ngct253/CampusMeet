import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import type { DocumentNormalizer } from '../domain/ports';

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export class CampusMeetDocumentNormalizer implements DocumentNormalizer {
  async normalize(content: Uint8Array, contentType: string): Promise<string> {
    const buffer = Buffer.from(content);
    switch (contentType) {
      case 'text/plain':
        return normalizeWhitespace(buffer.toString('utf8'));
      case 'application/pdf':
        return normalizeWhitespace((await pdf(buffer)).text);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return normalizeWhitespace((await mammoth.extractRawText({ buffer })).value);
      default:
        throw new Error('UNSUPPORTED_DOCUMENT_TYPE');
    }
  }
}
