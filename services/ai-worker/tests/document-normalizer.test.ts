import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { CampusMeetDocumentNormalizer } from '../src/workflows/document-normalizer';

const normalizer = new CampusMeetDocumentNormalizer();
const bytes = (value: string) => Buffer.from(value, 'utf8');

describe('CampusMeetDocumentNormalizer', () => {
  it.each([
    ['text/markdown; charset=utf-8', '# Kế hoạch\r\n\r\nHoàn thành demo'],
    ['text/csv', 'task,owner\nDemo,Lan'],
    ['text/tab-separated-values', 'task\towner\nDemo\tLan'],
    ['text/yaml', 'task: Demo\nowner: Lan'],
    ['text/calendar', 'BEGIN:VEVENT\nSUMMARY:CampusMeet demo\nEND:VEVENT'],
  ])('normalizes text-based content type %s', async (contentType, input) => {
    const result = await normalizer.normalize(bytes(input), contentType);
    expect(result.toLocaleLowerCase('vi-VN')).toContain('demo');
  });

  it('validates JSON and NDJSON before returning normalized text', async () => {
    await expect(
      normalizer.normalize(bytes('{"task":"Demo","owner":"Lan"}'), 'application/json'),
    ).resolves.toContain('"task": "Demo"');
    await expect(
      normalizer.normalize(bytes('{"task":"Demo"}\n{"task":"Test"}'), 'application/x-ndjson'),
    ).resolves.toContain('{"task":"Test"}');
    await expect(normalizer.normalize(bytes('{invalid'), 'application/json')).rejects.toThrow(
      'INVALID_JSON_DOCUMENT',
    );
  });

  it('extracts readable HTML/XML and discards executable or styling content', async () => {
    const html = `
      <html><head><style>.hidden { color: red }</style></head>
      <body><h1>Quyết định &amp; công việc</h1><script>alert('secret')</script><p>Chốt demo.</p></body></html>
    `;

    const result = await normalizer.normalize(bytes(html), 'text/html');

    expect(result).toContain('Quyết định & công việc');
    expect(result).toContain('Chốt demo.');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('color: red');
  });

  it('extracts slides from PPTX in numeric slide order', async () => {
    const archive = new JSZip();
    archive.file('ppt/presentation.xml', '<p:presentation />');
    archive.file('ppt/slides/slide10.xml', '<p:sld><a:t>Kết luận</a:t></p:sld>');
    archive.file('ppt/slides/slide2.xml', '<p:sld><a:t>Phạm vi</a:t></p:sld>');
    archive.file('ppt/slides/slide1.xml', '<p:sld><a:t>Mở đầu</a:t></p:sld>');
    const content = await archive.generateAsync({ type: 'uint8array' });

    const result = await normalizer.normalize(
      content,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );

    expect(result).toMatch(/Slide 1\nMở đầu[\s\S]*Slide 2\nPhạm vi[\s\S]*Slide 3\nKết luận/);
  });

  it('resolves shared strings and values from XLSX worksheets', async () => {
    const archive = new JSZip();
    archive.file('xl/workbook.xml', '<workbook />');
    archive.file(
      'xl/sharedStrings.xml',
      '<sst><si><t>Công việc</t></si><si><t>Hoàn thành demo</t></si></sst>',
    );
    archive.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c><v>42</v></c></row></sheetData></worksheet>',
    );
    const content = await archive.generateAsync({ type: 'uint8array' });

    const result = await normalizer.normalize(
      content,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    expect(result).toContain('Công việc Hoàn thành demo 42');
  });

  it('extracts content.xml from OpenDocument files', async () => {
    const archive = new JSZip();
    archive.file('mimetype', 'application/vnd.oasis.opendocument.text');
    archive.file(
      'content.xml',
      '<office:document-content><text:p>Biên bản CampusMeet</text:p></office:document-content>',
    );
    const content = await archive.generateAsync({ type: 'uint8array' });

    await expect(
      normalizer.normalize(content, 'application/vnd.oasis.opendocument.text'),
    ).resolves.toBe('Biên bản CampusMeet');
  });

  it('returns stable safe errors for corrupt or unsupported documents', async () => {
    await expect(
      normalizer.normalize(
        bytes('not-a-zip'),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).rejects.toThrow('INVALID_OFFICE_DOCUMENT');
    await expect(normalizer.normalize(bytes('binary'), 'application/octet-stream')).rejects.toThrow(
      'UNSUPPORTED_DOCUMENT_TYPE',
    );
    await expect(normalizer.normalize(bytes('not a PDF'), 'application/pdf')).rejects.toThrow(
      'INVALID_PDF_DOCUMENT',
    );
    await expect(normalizer.normalize(new Uint8Array([0xc3, 0x28]), 'text/plain')).rejects.toThrow(
      'INVALID_TEXT_ENCODING',
    );
  });

  it('rejects a valid ZIP that does not contain the declared Office structure', async () => {
    const archive = new JSZip();
    archive.file('unrelated.txt', 'not a presentation');
    const content = await archive.generateAsync({ type: 'uint8array' });

    await expect(
      normalizer.normalize(
        content,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).rejects.toThrow('INVALID_OFFICE_DOCUMENT');
  });

  it('stops extracting a compressed Office entry above the normalized-size limit', async () => {
    const archive = new JSZip();
    archive.file('ppt/presentation.xml', '<p:presentation />');
    archive.file('ppt/slides/slide1.xml', `<a:t>${'x'.repeat(5_000_001)}</a:t>`);
    const content = await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

    await expect(
      normalizer.normalize(
        content,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).rejects.toThrow('OFFICE_ARCHIVE_TOO_LARGE');
  });
});
