import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import type { DocumentNormalizer } from '../domain/ports';

const MAX_NORMALIZED_CHARACTERS = 5_000_000;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const normalizeWhitespace = (value: string) =>
  value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const ensureSafeLength = (value: string) => {
  if (value.length > MAX_NORMALIZED_CHARACTERS) throw new Error('NORMALIZED_SOURCE_TOO_LARGE');
  return value;
};

const decodeUtf8 = (buffer: Buffer) => {
  try {
    return utf8Decoder.decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('INVALID_TEXT_ENCODING');
  }
};

const decodeEntity = (entity: string) => {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  if (entity in named) return named[entity]!;
  const numeric = entity.startsWith('#x')
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith('#')
      ? Number.parseInt(entity.slice(1), 10)
      : Number.NaN;
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
    ? String.fromCodePoint(numeric)
    : `&${entity};`;
};

const markupToText = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/<!--[^]*?-->/g, ' ')
      .replace(/<(script|style|noscript)\b[^>]*>[^]*?<\/\1>/gi, ' ')
      .replace(/<!\[CDATA\[([^]*?)\]\]>/g, '$1')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|text:p|draw:page)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity: string) =>
        decodeEntity(entity.toLowerCase()),
      ),
  );

const normalizedText = (buffer: Buffer) =>
  ensureSafeLength(normalizeWhitespace(decodeUtf8(buffer)));

const normalizedStructuredText = (buffer: Buffer) =>
  ensureSafeLength(
    decodeUtf8(buffer)
      .replace(/\r\n?/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim(),
  );

const normalizedJson = (buffer: Buffer) => {
  try {
    return ensureSafeLength(JSON.stringify(JSON.parse(decodeUtf8(buffer)), null, 2));
  } catch {
    throw new Error('INVALID_JSON_DOCUMENT');
  }
};

const normalizedNdjson = (buffer: Buffer) => {
  try {
    const lines = decodeUtf8(buffer)
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.stringify(JSON.parse(line)));
    return ensureSafeLength(lines.join('\n'));
  } catch {
    throw new Error('INVALID_NDJSON_DOCUMENT');
  }
};

const sortedArchivePaths = (archive: JSZip, pattern: RegExp) =>
  Object.keys(archive.files)
    .filter((path) => pattern.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const readArchiveFile = async (archive: JSZip, path: string) => {
  const file = archive.file(path);
  if (!file) throw new Error('INVALID_OFFICE_DOCUMENT');
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    const stream = file.nodeStream('nodebuffer') as Readable;
    stream.on('data', (chunk: Buffer) => {
      byteLength += chunk.length;
      if (byteLength > MAX_NORMALIZED_CHARACTERS) {
        settled = true;
        reject(new Error('OFFICE_ARCHIVE_TOO_LARGE'));
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error) => {
      if (!settled) reject(error);
    });
    stream.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
};

const normalizePresentation = async (archive: JSZip) => {
  if (!archive.file('ppt/presentation.xml')) throw new Error('INVALID_OFFICE_DOCUMENT');
  const slides = sortedArchivePaths(archive, /^ppt\/slides\/slide\d+\.xml$/);
  if (!slides.length) throw new Error('INVALID_OFFICE_DOCUMENT');
  const content: string[] = [];
  let characterCount = 0;
  for (const [index, path] of slides.entries()) {
    const slide = `Slide ${index + 1}\n${markupToText(await readArchiveFile(archive, path))}`;
    characterCount += slide.length;
    if (characterCount > MAX_NORMALIZED_CHARACTERS) {
      throw new Error('NORMALIZED_SOURCE_TOO_LARGE');
    }
    content.push(slide);
  }
  return normalizeWhitespace(content.join('\n\n'));
};

const extractSpreadsheetRow = (rowXml: string, sharedStrings: string[]) =>
  [...rowXml.matchAll(/<c\b([^>]*)>([^]*?)<\/c>/gi)]
    .map((match) => {
      const attributes = match[1] ?? '';
      const body = match[2] ?? '';
      const value = body.match(/<v>([^]*?)<\/v>/i)?.[1];
      if (/\bt=["']s["']/i.test(attributes) && value !== undefined) {
        return sharedStrings[Number.parseInt(value, 10)] ?? '';
      }
      if (/\bt=["']inlineStr["']/i.test(attributes)) return markupToText(body);
      return value === undefined ? markupToText(body) : markupToText(value);
    })
    .join('\t');

const normalizeSpreadsheet = async (archive: JSZip) => {
  if (!archive.file('xl/workbook.xml')) throw new Error('INVALID_OFFICE_DOCUMENT');
  const sharedStringsXml = archive.file('xl/sharedStrings.xml')
    ? await readArchiveFile(archive, 'xl/sharedStrings.xml')
    : '';
  const sharedStrings = [...sharedStringsXml.matchAll(/<si\b[^>]*>([^]*?)<\/si>/gi)].map((match) =>
    markupToText(match[1] ?? ''),
  );
  const sheets = sortedArchivePaths(archive, /^xl\/worksheets\/sheet\d+\.xml$/);
  if (!sheets.length) throw new Error('INVALID_OFFICE_DOCUMENT');
  const content: string[] = [];
  let characterCount = 0;
  for (const [index, path] of sheets.entries()) {
    const worksheet = await readArchiveFile(archive, path);
    const rows = [...worksheet.matchAll(/<row\b[^>]*>([^]*?)<\/row>/gi)].map((match) =>
      extractSpreadsheetRow(match[1] ?? '', sharedStrings),
    );
    const sheet = `Sheet ${index + 1}\n${rows.join('\n')}`;
    characterCount += sheet.length;
    if (characterCount > MAX_NORMALIZED_CHARACTERS) {
      throw new Error('NORMALIZED_SOURCE_TOO_LARGE');
    }
    content.push(sheet);
  }
  return normalizeWhitespace(content.join('\n\n'));
};

const normalizeOpenDocument = async (archive: JSZip, contentType: string) => {
  const declaredType = (await readArchiveFile(archive, 'mimetype')).trim();
  if (declaredType !== contentType) throw new Error('INVALID_OFFICE_DOCUMENT');
  return ensureSafeLength(markupToText(await readArchiveFile(archive, 'content.xml')));
};

const loadArchive = async (buffer: Buffer) => {
  try {
    return await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('INVALID_OFFICE_DOCUMENT');
  }
};

const normalizeWordDocument = async (buffer: Buffer) => {
  const archive = await loadArchive(buffer);
  if (!archive.file('word/document.xml')) throw new Error('INVALID_OFFICE_DOCUMENT');
  try {
    return ensureSafeLength(normalizeWhitespace((await mammoth.extractRawText({ buffer })).value));
  } catch {
    throw new Error('INVALID_OFFICE_DOCUMENT');
  }
};

const normalizePdf = async (buffer: Buffer) => {
  if (buffer.subarray(0, 1_024).indexOf('%PDF-') < 0) throw new Error('INVALID_PDF_DOCUMENT');
  try {
    return ensureSafeLength(normalizeWhitespace((await pdf(buffer)).text));
  } catch (error) {
    if (error instanceof Error && error.message === 'NORMALIZED_SOURCE_TOO_LARGE') throw error;
    throw new Error('INVALID_PDF_DOCUMENT');
  }
};

const normalizeArchiveDocument = async (buffer: Buffer, contentType: string) => {
  const archive = await loadArchive(buffer);
  switch (contentType) {
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return normalizePresentation(archive);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return normalizeSpreadsheet(archive);
    case 'application/vnd.oasis.opendocument.text':
    case 'application/vnd.oasis.opendocument.presentation':
    case 'application/vnd.oasis.opendocument.spreadsheet':
      return normalizeOpenDocument(archive, contentType);
    default:
      throw new Error('UNSUPPORTED_DOCUMENT_TYPE');
  }
};

const structuredTextContentTypes = new Set([
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/calendar',
  'text/yaml',
  'text/x-yaml',
  'application/yaml',
  'application/x-yaml',
]);

export class CampusMeetDocumentNormalizer implements DocumentNormalizer {
  async normalize(content: Uint8Array, contentType: string): Promise<string> {
    const buffer = Buffer.from(content);
    const canonicalContentType = contentType.split(';', 1)[0]!.trim().toLowerCase();
    if (structuredTextContentTypes.has(canonicalContentType))
      return normalizedStructuredText(buffer);
    switch (canonicalContentType) {
      case 'text/plain':
        return normalizedText(buffer);
      case 'application/json':
        return normalizedJson(buffer);
      case 'application/x-ndjson':
      case 'application/ndjson':
        return normalizedNdjson(buffer);
      case 'text/html':
      case 'application/xhtml+xml':
      case 'application/xml':
      case 'text/xml':
        return ensureSafeLength(markupToText(decodeUtf8(buffer)));
      case 'application/pdf':
        return normalizePdf(buffer);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return normalizeWordDocument(buffer);
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.oasis.opendocument.text':
      case 'application/vnd.oasis.opendocument.presentation':
      case 'application/vnd.oasis.opendocument.spreadsheet':
        return normalizeArchiveDocument(buffer, canonicalContentType);
      default:
        throw new Error('UNSUPPORTED_DOCUMENT_TYPE');
    }
  }
}
