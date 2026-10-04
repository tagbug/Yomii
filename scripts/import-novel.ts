#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { clearNovelCache, decodeBuffer, getNovelData } from '../src/lib/novel';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Usage:
  bun run import <file.txt> [options]

Options:
  --title <string>       Set book title (defaults to auto-detected)
  --author <string>      Set author (defaults to auto-detected)
  --site-name <string>   Set site name (defaults to current config or "Yomii")
  --base-path <string>   Set deployment base path (e.g. "/read")
  --dry-run              Inspect and validate only without writing files
  --no-build             Skip automatic build after import
  -h, --help             Show this help message

Examples:
  bun run import ./novel.txt
  bun run import ./novel.txt --title "书名" --author "作者"
`);
}

if (!args.length || args.includes('-h') || args.includes('--help')) {
  printHelp();
  process.exit(args.length ? 0 : 1);
}

let inputPath = '';
let titleOverride = '';
let authorOverride = '';
let siteNameOverride = '';
let basePathOverride: string | undefined = undefined;
let dryRun = false;
let autoBuild = true;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--title' && i + 1 < args.length) {
    titleOverride = args[++i];
  } else if (arg === '--author' && i + 1 < args.length) {
    authorOverride = args[++i];
  } else if (arg === '--site-name' && i + 1 < args.length) {
    siteNameOverride = args[++i];
  } else if (arg === '--base-path' && i + 1 < args.length) {
    basePathOverride = args[++i];
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else if (arg === '--no-build') {
    autoBuild = false;
  } else if (!arg.startsWith('-') && !inputPath) {
    inputPath = arg;
  }
}

if (!inputPath) {
  console.error('Error: missing input text file path.');
  printHelp();
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`Error: file not found: ${resolvedInput}`);
  process.exit(1);
}

const rawBytes = fs.readFileSync(resolvedInput);
const text = decodeBuffer(rawBytes);

const ROOT = process.cwd();
const contentDir = path.join(ROOT, 'content');
fs.mkdirSync(contentDir, { recursive: true });

const targetFileName = path.basename(resolvedInput);
const targetFilePath = path.join(contentDir, targetFileName);

const configPath = path.join(ROOT, 'config.json');
let config: any = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {}
}

const originalSource = config.source;

if (!dryRun) {
  fs.writeFileSync(targetFilePath, text, 'utf-8');

  config.source = `content/${targetFileName}`;
  if (titleOverride) config.book_title = titleOverride;
  if (authorOverride) config.author = authorOverride;
  if (siteNameOverride) config.site_name = siteNameOverride;
  if (basePathOverride !== undefined) config.base_path = basePathOverride;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

clearNovelCache();
let novelData;
try {
  novelData = getNovelData(ROOT);
} catch (e: any) {
  console.error(`Parse error: ${e.message}`);
  if (!dryRun && originalSource) {
    config.source = originalSource;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
  process.exit(1);
}

const totalChars = novelData.chapters.reduce((acc, c) => acc + c.chars, 0);

console.log(`\nImported:   ${targetFileName}`);
console.log(`Title:      ${novelData.title}`);
console.log(`Author:     ${novelData.author || 'N/A'}`);
console.log(`Chapters:   ${novelData.totalChapters}${novelData.groups.length > 1 ? ` (${novelData.groups.length} volumes)` : ''}`);
console.log(`Characters: ${totalChars.toLocaleString()} chars\n`);

if (dryRun) {
  process.exit(0);
}

if (autoBuild) {
  const proc = Bun.spawnSync(['bun', 'run', 'build'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode);
  }

  const testProc = Bun.spawnSync(['bun', 'test'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (testProc.exitCode !== 0) {
    process.exit(testProc.exitCode);
  }
}
