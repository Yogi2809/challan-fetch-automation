import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';

export async function saveFile(buffer, filename) {
  if (!existsSync(config.localUploadDir)) {
    mkdirSync(config.localUploadDir, { recursive: true });
  }
  const filePath = join(config.localUploadDir, filename);
  writeFileSync(filePath, buffer);
  return filePath;
}
