import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
