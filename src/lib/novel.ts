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
  sourcePath: string;
  sourceFileName: string;
  sha256: string;
  bytes: number;
  groups: Group[];
  chapters: Chapter[];
  totalChapters: number;
  rawText: string;
}

let cachedData: NovelData | null = null;

export function clearNovelCache(): void {
  cachedData = null;
}

export function decodeBuffer(buffer: Buffer): string {
  // UTF-8 with BOM
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf-8');
  }
  // Try UTF-8
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch {
    // Fallback to GB18030 (which covers GBK and GB2312)
    const decoder = new TextDecoder('gb18030');
    return decoder.decode(buffer);
  }
}

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

  let text = decodeBuffer(raw);
  const lines = text.split(/\r?\n/);
  if (!lines.length || lines.every((l) => !l.trim())) {
    throw new Error('Novel file is empty.');
  }

  const siteName = config.site_name || 'Yomii';
  const envBasePath = process.env.BASE_PATH;
  const rawBasePath = (envBasePath !== undefined ? envBasePath : config.base_path || '').trim().replace(/^\/|\/$/g, '');
  const basePath = rawBasePath ? `/${rawBasePath}` : '';

  let title = (config.book_title || '').trim();
  let author = (config.author || '').trim();

  // Heuristic extraction for author and title in header lines
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const authorMatch = l.match(/^(?:作者|著)[：:]\s*(.+)$/i);
    if (authorMatch && !author) {
      author = authorMatch[1].trim();
      continue;
    }
    const titleMatch = l.match(/^(?:书名)[：:]\s*(.+)$/i) || l.match(/^《(.+?)》$/);
    if (titleMatch && !title) {
      title = (titleMatch[1] || titleMatch[2]).trim();
      continue;
    }
  }

  if (!title) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const l = lines[i].trim();
      if (
        l &&
        !l.startsWith('【') &&
        !l.startsWith('=') &&
        !l.startsWith('-') &&
        !/^(?:作者|著)[：:]/.test(l)
      ) {
        title = l.replace(/^《|》$/g, '');
        break;
      }
    }
  }

  if (!title) {
    title = path.basename(sourcePath, path.extname(sourcePath));
  }

  const groups: Group[] = [];
  const chapters: Chapter[] = [];
  let currentGroup: Group | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Volume / Track patterns
    const trackMatch =
      line.match(/^【(?:Track|分卷|卷)[^：:]*[：:](.+)】$/i) ||
      line.match(/^第\s*([0-9一二三四五六七八九十百千万]+)\s*卷\s*(.*)$/) ||
      line.match(/^卷\s*([0-9一二三四五六七八九十百千万]+)\s+(.*)$/);
    if (trackMatch) {
      const name = (
        trackMatch[2] !== undefined ? trackMatch[2] || trackMatch[1] : trackMatch[1]
      ).trim();
      currentGroup = {
        index: groups.length + 1,
        name: name || `分卷 ${groups.length + 1}`,
        line: i,
      };
      groups.push(currentGroup);
      continue;
    }

    // Chapter patterns
    const chapterMatch =
      line.match(/^第\s*([0-9一二三四五六七八九十百千万]+)\s*[话章节回节部幕折篇集]\s*(.*)$/) ||
      line.match(/^(?:Chapter|CHAPTER)\s*(\d+|[IVXLCDM]+)[\s:：.-]*(.*)$/) ||
      line.match(/^(序章|引子|序言|序|楔子|前言)[\s:：.-]*(.*)$/) ||
      line.match(/^(尾声|后记|结语|跋|番外(?:\s*\d+)?|外传)[\s:：.-]*(.*)$/);

    if (chapterMatch) {
      if (!currentGroup) {
        currentGroup = {
          index: 1,
          name: title || '正文',
          line: -1,
        };
        groups.push(currentGroup);
      }

      const rawTitle = (
        chapterMatch[2] !== undefined ? chapterMatch[2] : chapterMatch[1] || ''
      ).trim();
      chapters.push({
        number: chapters.length + 1,
        title: rawTitle || line,
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
    throw new Error('未在小说文本中找到章节。支持“第X章/话/节”、“Chapter X”、“序章”、“尾声”等常见格式。');
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
      .filter((l) => l.trim() && !/^[-=~*]{3,}$/.test(l.trim()));
    c.chars = c.paragraphs.reduce((acc, l) => acc + l.trim().length, 0);
    c.readMinutes = Math.max(1, Math.round(c.chars / 500));
  }

  cachedData = {
    title,
    author,
    siteName,
    basePath,
    bookId,
    sourcePath,
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
