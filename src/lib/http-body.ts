import { reject } from './model-errors';
import { hasSafeJsonDepth } from './json-depth';
export async function readJsonBody(req: Request, required = true) {
  if (Number(req.headers.get('content-length') ?? 0) > 2_000_000)
    reject(413, 'Файл слишком большой (максимум 2 МБ)');
  const reader = req.body?.getReader();
  if (!reader) reject(400, 'Тело запроса обязательно');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      reject(413, 'Файл слишком большой (максимум 2 МБ)');
    }
    chunks.push(chunk.value);
  }
  if (!size && !required) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    reject(400, 'Невалидный JSON');
  }
  if (!hasSafeJsonDepth(parsed)) reject(400, 'Слишком большая вложенность JSON');
  return parsed;
}
