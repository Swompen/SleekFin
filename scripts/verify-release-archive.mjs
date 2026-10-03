import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const archive = process.argv[2];
assert.ok(archive, 'usage: node scripts/verify-release-archive.mjs <archive.zip>');

const expected = [
  'Jellyfin.Plugin.SleekFin.dll',
  'LICENSE',
  'meta.json',
  'thumb.png',
];
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  .sort();
assert.deepEqual(entries, expected, 'release archive contents must match the distributable contract');

const license = execFileSync('unzip', ['-p', archive, 'LICENSE'], { encoding: 'utf8' });
assert.match(license, /Copyright \(c\) 2026 varunaditya-plus/);
assert.match(license, /Permission is hereby granted, free of charge/);

console.log(`Verified release archive: ${entries.join(', ')}`);