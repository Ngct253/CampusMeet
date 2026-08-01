declare module 'pdf-parse/lib/pdf-parse.js' {
  export default function parse(buffer: Buffer): Promise<{ text: string }>;
}
