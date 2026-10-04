#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

type DeployTarget = 'cloudflare' | 'vercel' | 'github';

interface DeployOptions {
  target?: DeployTarget;
  project?: string;
  domain?: string;
  noBuild?: boolean;
}

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadConfig(): Record<string, any> {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
  }
  return {};
}

function printHelp() {
  console.log(`
Usage:
  bun run deploy [options]

Options:
  --target <name>      Deployment target: cloudflare, vercel, github
  --project <name>     Project name (defaults to site_name in config.json or "yomii")
  --domain <domain>    Custom domain (e.g. "read.example.com")
  --no-build           Skip automatic build before deploying
  -h, --help           Show this help message

Examples:
  bun run deploy
  bun run deploy --target cloudflare --project my-reader --domain read.example.com
  bun run deploy --target vercel
  bun run deploy --target github --domain read.example.com
`);
}

function commandExists(cmd: string): boolean {
  try {
    const res = Bun.spawnSync(['which', cmd], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

function resolveCli(primary: string, pkg: string): string[] {
  if (commandExists(primary)) {
    return [primary];
  }
  return ['bunx', pkg];
}

function runCommand(cmd: string[], opts?: { ignoreError?: boolean }): number {
  console.log(`$ ${cmd.join(' ')}`);
  const proc = Bun.spawnSync(cmd, {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (proc.exitCode !== 0 && !opts?.ignoreError) {
    console.error(`Error: command failed with exit code ${proc.exitCode}`);
  }
  return proc.exitCode;
}

function runSilent(cmd: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const proc = Bun.spawnSync(cmd, {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout ? new TextDecoder().decode(proc.stdout).trim() : '',
      stderr: proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : '',
    };
  } catch (e: any) {
    return { exitCode: 1, stdout: '', stderr: e.message || '' };
  }
}

function sanitizeProjectName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'yomii';
}

function buildProject(): boolean {
  console.log('\n--- Building static site ---');
  const code = runCommand(['bun', 'run', 'build']);
  if (code !== 0) {
    console.error('Build failed. Aborting deployment.');
    return false;
  }
  if (!fs.existsSync(DIST)) {
    console.error(`Error: output directory "${DIST}" not found.`);
    return false;
  }
  return true;
}

async function checkCloudflareAuth(cli: string[]): Promise<boolean> {
  const check = runSilent([...cli, 'whoami']);
  if (check.exitCode === 0 && !check.stdout.includes('not logged in')) {
    return true;
  }
  console.log('\nCloudflare authentication required.');
  console.log('Initiating authentication with Cloudflare...\n');
  const loginCode = runCommand([...cli, 'login']);
  return loginCode === 0;
}

async function deployCloudflare(
  project: string,
  domain: string | undefined
): Promise<void> {
  const cli = resolveCli('wrangler', 'wrangler');
  const authed = await checkCloudflareAuth(cli);
  if (!authed) {
    console.error('Cloudflare authentication failed. Aborting deployment.');
    process.exit(1);
  }

  console.log(`\nDeploying to Cloudflare Pages (project: ${project})...`);
  const deployArgs = [
    ...cli,
    'pages',
    'deploy',
    'dist',
    `--project-name=${project}`,
    '--commit-dirty=true',
  ];

  const code = runCommand(deployArgs);
  if (code !== 0) {
    console.error('Cloudflare Pages deployment failed.');
    process.exit(code);
  }

  console.log('\nCloudflare Pages deployment completed.');
  console.log(`Default URL: https://${project}.pages.dev`);

  if (domain) {
    console.log(`\nCustom domain configured: ${domain}`);
    console.log('Ensure the following DNS record is configured:');
    console.log(`  Type:  CNAME`);
    console.log(`  Name:  ${domain}`);
    console.log(`  Target: ${project}.pages.dev`);
    console.log(
      'Verify or bind domain in Cloudflare dashboard: Pages > Project > Custom domains'
    );
  }
}

async function checkVercelAuth(cli: string[]): Promise<boolean> {
  const check = runSilent([...cli, 'whoami']);
  if (check.exitCode === 0 && check.stdout.length > 0) {
    return true;
  }
  console.log('\nVercel authentication required.');
  console.log('Initiating authentication with Vercel...\n');
  const loginCode = runCommand([...cli, 'login']);
  return loginCode === 0;
}

async function deployVercel(
  project: string,
  domain: string | undefined
): Promise<void> {
  const cli = resolveCli('vercel', 'vercel');
  const authed = await checkVercelAuth(cli);
  if (!authed) {
    console.error('Vercel authentication failed. Aborting deployment.');
    process.exit(1);
  }

  console.log(`\nDeploying to Vercel (project: ${project})...`);
  const deployArgs = [
    ...cli,
    'deploy',
    'dist',
    '--prod',
    '--yes',
    `--name=${project}`,
  ];

  const code = runCommand(deployArgs);
  if (code !== 0) {
    console.error('Vercel deployment failed.');
    process.exit(code);
  }

  console.log('\nVercel deployment completed.');

  if (domain) {
    console.log(`\nConfiguring custom domain "${domain}" on Vercel...`);
    runCommand([...cli, 'domains', 'add', domain, project], { ignoreError: true });
    console.log('Ensure the following DNS record is configured:');
    console.log(`  Type:  CNAME`);
    console.log(`  Name:  ${domain}`);
    console.log(`  Target: cname.vercel-dns.com`);
  }
}

async function checkGitHubAuth(): Promise<boolean> {
  if (commandExists('gh')) {
    const status = runSilent(['gh', 'auth', 'status']);
    if (status.exitCode === 0) {
      return true;
    }
    console.log('\nGitHub CLI authentication required.');
    console.log('Running "gh auth login"...\n');
    const loginCode = runCommand(['gh', 'auth', 'login']);
    return loginCode === 0;
  }
  return true;
}

async function deployGitHub(domain: string | undefined): Promise<void> {
  const authed = await checkGitHubAuth();
  if (!authed) {
    console.error('GitHub authentication failed. Aborting deployment.');
    process.exit(1);
  }

  const remoteCheck = runSilent(['git', 'remote', 'get-url', 'origin']);
  if (remoteCheck.exitCode !== 0 || !remoteCheck.stdout) {
    console.error('Error: no git remote "origin" found.');
    console.error('GitHub Pages deployment requires a remote repository (e.g. git@github.com:user/repo.git).');
    process.exit(1);
  }

  const remoteUrl = remoteCheck.stdout.trim();
  console.log(`Target repository: ${remoteUrl}`);

  if (domain) {
    fs.writeFileSync(path.join(DIST, 'CNAME'), domain.trim(), 'utf-8');
  }

  const cli = resolveCli('gh-pages', 'gh-pages');
  const deployArgs = [
    ...cli,
    '-d',
    'dist',
    '--dotfiles',
    '--nojekyll',
  ];

  if (domain) {
    deployArgs.push('--cname', domain);
  }

  console.log('\nPublishing to gh-pages branch...');
  const code = runCommand(deployArgs);
  if (code !== 0) {
    console.error('GitHub Pages deployment failed.');
    process.exit(code);
  }

  console.log('\nGitHub Pages deployment completed.');
  if (domain) {
    console.log(`Custom domain configured: https://${domain}`);
    console.log('Ensure the following DNS record is configured:');
    console.log(`  Type:  CNAME`);
    console.log(`  Name:  ${domain}`);
    console.log('  Target: <username>.github.io');
  } else {
    console.log('Site will be available at your GitHub Pages URL (check repository settings > Pages).');
  }
}

async function parseArgs(): Promise<DeployOptions> {
  const args = process.argv.slice(2);
  const options: DeployOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === '--target' && i + 1 < args.length) {
      const val = args[++i].toLowerCase();
      if (val === 'cloudflare' || val === 'cf') options.target = 'cloudflare';
      else if (val === 'vercel') options.target = 'vercel';
      else if (val === 'github' || val === 'gh') options.target = 'github';
      else {
        console.error(`Invalid target: ${val}. Must be cloudflare, vercel, or github.`);
        process.exit(1);
      }
    } else if (arg === '--project' && i + 1 < args.length) {
      options.project = args[++i];
    } else if (arg === '--domain' && i + 1 < args.length) {
      options.domain = args[++i];
    } else if (arg === '--no-build') {
      options.noBuild = true;
    }
  }

  return options;
}

async function promptInteractive(
  opts: DeployOptions,
  config: Record<string, any>
): Promise<Required<Omit<DeployOptions, 'domain'>> & { domain?: string }> {
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;

  let target = opts.target;
  let project = opts.project;
  let domain = opts.domain;
  let noBuild = opts.noBuild || false;

  if (!isTTY) {
    if (!target) {
      console.error('Error: non-interactive environment requires --target <cloudflare|vercel|github>');
      printHelp();
      process.exit(1);
    }
    const defaultProj = sanitizeProjectName(config.site_name || 'yomii');
    return {
      target,
      project: project || defaultProj,
      domain,
      noBuild,
    };
  }

  const rl = readline.createInterface({ input, output });

  try {
    if (!target) {
      console.log('\nSelect deployment target:');
      console.log('  1) Cloudflare Pages');
      console.log('  2) Vercel');
      console.log('  3) GitHub Pages');

      while (!target) {
        const choice = (await rl.question('Enter choice [1-3] (default 1): ')).trim();
        if (choice === '' || choice === '1' || choice.toLowerCase() === 'cloudflare') {
          target = 'cloudflare';
        } else if (choice === '2' || choice.toLowerCase() === 'vercel') {
          target = 'vercel';
        } else if (choice === '3' || choice.toLowerCase() === 'github') {
          target = 'github';
        } else {
          console.log('Invalid choice. Enter 1, 2, or 3.');
        }
      }
    }

    const defaultProj = sanitizeProjectName(config.site_name || 'yomii');
    if (!project && target !== 'github') {
      const projInput = (
        await rl.question(`Project name (default "${defaultProj}"): `)
      ).trim();
      project = projInput ? sanitizeProjectName(projInput) : defaultProj;
    } else if (!project) {
      project = defaultProj;
    }

    if (domain === undefined) {
      const useDomain = (
        await rl.question('Configure custom domain? [y/N]: ')
      ).trim().toLowerCase();
      if (useDomain === 'y' || useDomain === 'yes') {
        const domainInput = (await rl.question('Custom domain (e.g. read.example.com): ')).trim();
        if (domainInput) {
          domain = domainInput;
        }
      }
    }
  } finally {
    rl.close();
  }

  return {
    target,
    project: project || sanitizeProjectName(config.site_name || 'yomii'),
    domain,
    noBuild,
  };
}

async function main() {
  const parsed = await parseArgs();
  const config = loadConfig();
  const options = await promptInteractive(parsed, config);

  if (!options.noBuild) {
    const ok = buildProject();
    if (!ok) process.exit(1);
  }

  switch (options.target) {
    case 'cloudflare':
      await deployCloudflare(options.project, options.domain);
      break;
    case 'vercel':
      await deployVercel(options.project, options.domain);
      break;
    case 'github':
      await deployGitHub(options.domain);
      break;
  }
}

main().catch((err) => {
  console.error(`Deployment error: ${err.message || err}`);
  process.exit(1);
});
