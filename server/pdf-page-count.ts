import { PDFDocument } from "pdf-lib";

/**
 * Page count from a PDF parser, including compressed object streams.
 * A file whose structure still cannot be read returns null. Callers accept it.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const count = doc.getPageCount();
    if (!Number.isInteger(count) || count < 1) return null;
    return count;
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(`[patient-documents] PDF page count unavailable; accepting the file. ${message}`);
    return null;
  }
}
