import { defineConfig } from 'astro/config';
import fs from 'node:fs';
import path from 'node:path';
import { getNovelData } from './src/lib/novel.ts';

const novel = getNovelData();

// Sync novel download file to public/downloads/
const publicDownloadsDir = path.resolve('./public/downloads');
fs.mkdirSync(publicDownloadsDir, { recursive: true });
const sourceFilePath = path.resolve(novel.sourceFileName === 'novel.txt' ? 'content/novel.txt' : novel.sourceFileName);
fs.copyFileSync(sourceFilePath, path.join(publicDownloadsDir, novel.sourceFileName));

export default defineConfig({
  output: 'static',
  base: novel.basePath || undefined,
  build: {
    format: 'directory',
  },
  outDir: './dist',
});
