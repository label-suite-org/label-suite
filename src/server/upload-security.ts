import { HttpError } from "./errors";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

export async function boundedMultipartRequest(request: Request, maxBytes = MAX_MULTIPART_BYTES): Promise<Request> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) throw new HttpError("Upload body is too large", 413);
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("Upload body is too large");
      throw new HttpError("Upload body is too large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

export function assertGrantDocumentSignature(file: File, bytes: Uint8Array): void {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const text = new TextDecoder("latin1").decode(bytes);
  let valid = true;
  if (extension === ".pdf") valid = text.startsWith("%PDF-");
  else if (extension === ".png") valid = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  else if (extension === ".jpg" || extension === ".jpeg") valid = starts(0xff, 0xd8, 0xff);
  else if (extension === ".docx" || extension === ".xlsx") {
    valid = starts(0x50, 0x4b, 0x03, 0x04) && text.includes("[Content_Types].xml") && text.includes(extension === ".docx" ? "word/" : "xl/");
  } else if (extension === ".doc" || extension === ".xls") valid = starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  else if (extension === ".rtf") valid = text.startsWith("{\\rtf");
  else if (extension === ".csv" || extension === ".txt") valid = !bytes.includes(0);
  if (!valid) throw new HttpError("File content does not match its declared type", 415);
}
