import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const FORK_OWNER = 'Swompen';
const PLUGIN_GUID = 'da36c4ef-1d10-4169-8a68-26b194d5301a';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('release workflow publishes only fork-owned assets with automatic updates disabled', async () => {
  const workflow = await text('.github/workflows/release.yml');
  assert.match(workflow, /REPO_OWNER: "Swompen"/);
  assert.match(workflow, /owner: "Swompen"/);
  assert.match(workflow, /autoUpdate: false/);
  assert.doesNotMatch(workflow, /REPO_OWNER: "varunaditya-plus"/);
});

test('release archive includes the upstream MIT license', async () => {
  const workflow = await text('.github/workflows/release.yml');
  const license = await text('LICENSE');
  assert.match(workflow, /cp\s+"\$\{GITHUB_WORKSPACE\}\/LICENSE"\s+"\$\{OUT_DIR\}\/LICENSE"/);
  assert.match(workflow, /zip\s+-j\s+"\$\{ZIP_PATH\}"[\s\S]*\bLICENSE\b/);
  assert.match(workflow, /node scripts\/verify-release-archive\.mjs "\$\{ZIP_PATH\}"/);
  assert.match(license, /Copyright \(c\) 2026 varunaditya-plus/);
  assert.match(license, /Permission is hereby granted, free of charge/);
});

test('archive verifier enforces the exact distributable contents and MIT notice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sleekfin-archive-contract-'));
  const archive = join(directory, 'release.zip');
  const license = await text('LICENSE');
  await Promise.all([
    writeFile(join(directory, 'Jellyfin.Plugin.SleekFin.dll'), 'fixture'),
    writeFile(join(directory, 'meta.json'), '{}'),
    writeFile(join(directory, 'thumb.png'), 'fixture'),
    writeFile(join(directory, 'LICENSE'), license),
  ]);
  await exec('zip', ['-j', archive, 'Jellyfin.Plugin.SleekFin.dll', 'meta.json', 'thumb.png', 'LICENSE'], { cwd: directory });
  await exec(process.execPath, ['scripts/verify-release-archive.mjs', archive], { cwd: new URL('..', import.meta.url) });

  const invalid = join(directory, 'invalid.zip');
  await exec('zip', ['-j', invalid, 'meta.json'], { cwd: directory });
  await assert.rejects(exec(process.execPath, ['scripts/verify-release-archive.mjs', invalid], { cwd: new URL('..', import.meta.url) }));
});

test('fork manifest preserves plugin identity while using fork-owned catalog URLs', async () => {
  const manifest = JSON.parse(await text('manifest.json'));
  const plugin = manifest[0];
  assert.equal(plugin.guid, PLUGIN_GUID);
  assert.equal(plugin.name, 'SleekFin');
  assert.equal(plugin.owner, FORK_OWNER);
  assert.equal(plugin.repositoryUrl, 'https://github.com/Swompen/SleekFin');
  assert.equal(plugin.imageUrl, 'https://raw.githubusercontent.com/Swompen/SleekFin/main/thumb.png');
});

test('installed metadata preserves identity and disables silent catalog updates', async () => {
  const metadata = JSON.parse(await text('meta.json'));
  assert.equal(metadata.guid, PLUGIN_GUID);
  assert.equal(metadata.name, 'SleekFin');
  assert.equal(metadata.owner, FORK_OWNER);
  assert.equal(metadata.autoUpdate, false);
});

test('fork installation and upstream maintenance instructions are documented', async () => {
  const readme = await text('README.md');
  const maintenance = await text('FORK_MAINTENANCE.md');
  assert.match(readme, /raw\.githubusercontent\.com\/Swompen\/SleekFin\/main\/manifest\.json/);
  assert.match(readme, /remove the upstream.*manifest/si);
  assert.match(maintenance, /git fetch upstream/);
  assert.match(maintenance, /npm test/);
  assert.match(maintenance, /1\.4\.2\.3/);
});
