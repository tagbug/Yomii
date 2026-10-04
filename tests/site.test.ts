import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getNovelData } from '../src/lib/novel';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const novel = getNovelData();

test('static build files exist', () => {
  expect(fs.existsSync(path.join(DIST, 'index.html'))).toBe(true);
  expect(fs.existsSync(path.join(DIST, '404.html'))).toBe(true);

  for (const chapter of novel.chapters) {
    const chapterPath = path.join(
      DIST,
      'c',
      String(chapter.number).padStart(3, '0'),
      'index.html'
    );
    expect(fs.existsSync(chapterPath)).toBe(true);
  }
});

test('TXT download matches source novel byte-for-byte', () => {
  const sourcePath = novel.sourcePath;
  const downloadPath = path.join(DIST, 'downloads', novel.sourceFileName);

  expect(fs.existsSync(downloadPath)).toBe(true);

  const sourceBytes = fs.readFileSync(sourcePath);
  const downloadBytes = fs.readFileSync(downloadPath);

  const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const downloadHash = crypto.createHash('sha256').update(downloadBytes).digest('hex');

  expect(downloadHash).toBe(sourceHash);
  expect(downloadBytes.length).toBe(sourceBytes.length);
});

test('HTML pages have unique IDs and valid anchors', () => {
  function getHtmlFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        files = files.concat(getHtmlFiles(full));
      } else if (e.name.endsWith('.html')) {
        files.push(full);
      }
    }
    return files;
  }

  const htmlFiles = getHtmlFiles(DIST);
  expect(htmlFiles.length).toBeGreaterThanOrEqual(novel.totalChapters + 2);

  const pageIds = new Map<string, Set<string>>();

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const ids: string[] = [];
    const idMatches = content.matchAll(/id="([^"]+)"/g);
    for (const m of idMatches) {
      ids.push(m[1]);
    }

    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
    pageIds.set(file, uniqueIds);
  }

  // Verify internal anchor fragments
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const hrefMatches = content.matchAll(/href="([^"]+)"/g);

    for (const m of hrefMatches) {
      const href = m[1];
      if (href.startsWith('#') && href !== '#start') {
        const targetId = href.slice(1);
        const ids = pageIds.get(file);
        expect(ids?.has(targetId)).toBe(true);
      }
    }
  }
});
