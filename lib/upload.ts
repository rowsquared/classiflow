/**
 * Reads an uploaded CSV from multipart form data with a size limit, so an
 * oversized file is refused before it is decoded and parsed. The request body
 * itself is still received first: the reverse proxy's body limit is what stops
 * huge uploads at the edge (see DEPLOYMENT.md).
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export type UploadResult =
  | { ok: true; name: string; text: string }
  | { ok: false; error: string }

export async function readUpload(entry: FormDataEntryValue | null): Promise<UploadResult> {
  if (!entry || typeof entry === 'string') {
    return { ok: false, error: 'No file provided' }
  }
  if (entry.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` }
  }
  return { ok: true, name: entry.name, text: await entry.text() }
}
