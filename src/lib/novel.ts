import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Group {
  index: number;
  name: string;
  line: number;
}

export interface Chapter {
  number: number;
  title: string;
  heading: string;
  line: number;
  group: number;
  paragraphs: string[];
  chars: number;
  readMinutes: number;
}

export interface NovelConfig {
  site_name?: string;
  source?: string;
  book_title?: string;
  author?: string;
  base_path?: string;
}

export interface NovelData {
  title: string;
  author: string;
  siteName: string;
  basePath: string;
  bookId: string;
  sourceFileName: string;
  sha256: string;
  bytes: number;
  groups: Group[];
  chapters: Chapter[];
  totalChapters: number;
  rawText: string;
}

let cachedData: NovelData | null = null;

export function getNovelData(rootDir = process.cwd()): NovelData {
  if (cachedData) return cachedData;

  const configPath = path.join(rootDir, 'config.json');
  let config: NovelConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.error('Failed to parse config.json, using defaults.', e);
    }
  }

  const sourceRel = config.source || 'content/novel.txt';
  const sourcePath = path.resolve(rootDir, sourceRel);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source novel file not found: ${sourcePath}`);
  }

  const raw = fs.readFileSync(sourcePath);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const bytes = raw.length;

  let text = raw.toString('utf-8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const lines = text.split(/\r?\n/);
  if (!lines.length || lines.every((l) => !l.trim())) {
    throw new Error('Novel file is empty.');
  }

  const siteName = config.site_name || 'Yomii';
  const rawBasePath = (config.base_path || '').trim().replace(/^\/|\/$/g, '');
  const basePath = rawBasePath ? `/${rawBasePath}` : '';

  const title = (config.book_title || lines[0] || '').trim();
  let author = (config.author || '').trim();
  if (!author && lines.length > 1 && lines[1].trim().startsWith('作者：')) {
    author = lines[1].trim().split('：')[1]?.trim() || '';
  }

  const groups: Group[] = [];
  const chapters: Chapter[] = [];
  let currentGroup: Group | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const trackMatch = line.match(/^【Track([^：]+)：(.+)】$/);
    if (trackMatch) {
      currentGroup = {
        index: groups.length + 1,
        name: trackMatch[2].trim(),
        line: i,
      };
      groups.push(currentGroup);
      continue;
    }

    const chapterMatch = line.match(/^第\s*(\d+)\s*[话章节]\s+(.+)$/);
    if (chapterMatch) {
      if (!currentGroup) {
        currentGroup = {
          index: 1,
          name: title,
          line: -1,
        };
        groups.push(currentGroup);
      }
      chapters.push({
        number: parseInt(chapterMatch[1], 10),
        title: chapterMatch[2].trim(),
        heading: line,
        line: i,
        group: currentGroup.index,
        paragraphs: [],
        chars: 0,
        readMinutes: 1,
      });
    }
  }

  if (!chapters.length) {
    throw new Error('No chapters found in novel text.');
  }

  const totalChapters = chapters.length;
  const bookId = crypto.createHash('sha256').update(title).digest('hex').slice(0, 12);

  for (let i = 0; i < totalChapters; i++) {
    const c = chapters[i];
    let end = i + 1 < totalChapters ? chapters[i + 1].line : lines.length;
    const boundaries = groups
      .filter((g) => c.line < g.line && g.line < end)
      .map((g) => g.line);
    if (boundaries.length) {
      end = Math.min(...boundaries);
    }

    c.paragraphs = lines
      .slice(c.line + 1, end)
      .filter((l) => l.trim() && !/^[-=]{3,}$/.test(l.trim()));
    c.chars = c.paragraphs.reduce((acc, l) => acc + l.trim().length, 0);
    c.readMinutes = Math.max(1, Math.round(c.chars / 500));
  }

  cachedData = {
    title,
    author,
    siteName,
    basePath,
    bookId,
    sourceFileName: path.basename(sourcePath),
    sha256,
    bytes,
    groups,
    chapters,
    totalChapters,
    rawText: text,
  };

  return cachedData;
}
