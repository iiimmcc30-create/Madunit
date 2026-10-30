import { basename } from "node:path";

export interface DownloadedTelegramFile {
  buffer: Buffer;
  mime: string;
  fileName: string;
  dataUrl?: string;
}

const MAX_BYTES = 4 * 1024 * 1024;

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "image/jpeg";
}

export async function downloadTelegramFile(
  bot: { token: string; api: { getFile(fileId: string): Promise<{ file_path?: string }> } },
  fileId: string,
  asDataUrl = false,
): Promise<DownloadedTelegramFile | null> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) return null;
  const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_BYTES) return null;
  const mime = mimeFromPath(file.file_path);
  const fileName = basename(file.file_path) || "file.bin";
  return {
    buffer,
    mime,
    fileName,
    dataUrl: asDataUrl ? `data:${mime};base64,${buffer.toString("base64")}` : undefined,
  };
}
