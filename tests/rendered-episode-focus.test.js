import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

const CHROMIUM = process.env.CHROMIUM_PATH || '/usr/sbin/chromium';

function decodePng(buffer) {
  const chunks = [];
  let width;
  let height;
  let colorType;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'fixture screenshots must use 8-bit PNG channels');
      colorType = data[9];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported Chromium PNG color type ${colorType}`);
  const packed = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[source++];
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[source++];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else {
        assert.equal(filter, 4, `unsupported PNG filter ${filter}`);
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upperLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft);
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  return { channels, height, pixels, stride, width };
}

function pixel(image, x, y) {
  const offset = y * image.stride + x * image.channels;
  return Array.from(image.pixels.subarray(offset, offset + 3));
}

async function chromiumSession() {
  const profile = `${process.env.TMPDIR}/sleekfin-render-test-${process.pid}`;
  const chrome = spawn(CHROMIUM, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Chromium did not start: ${output}`)), 10000);
    chrome.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.once('error', reject);
    chrome.once('exit', (code) => reject(new Error(`Chromium exited before startup (${code}): ${output}`)));
  });
  const browser = new WebSocket(endpoint);
  await new Promise((resolve) => browser.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  browser.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const request = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    browser.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await request('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await request('Target.attachToTarget', { targetId, flatten: true });
  return { chrome, browser, send: (method, params = {}) => request(method, params, sessionId) };
}

test('image-bearing episode card visibly paints focus at desktop and TV viewports', { timeout: 30000 }, async (t) => {
  const css = await readFile(new URL('../src/Jellyfin.Plugin.SleekFin/Inject/Details/sleekfin-details-episodes.css', import.meta.url), 'utf8');
  const { chrome, browser, send } = await chromiumSession();
  t.after(() => { browser.close(); chrome.kill('SIGTERM'); });
  const output = process.env.SLEEKFIN_RENDER_ARTIFACTS;
  if (output) await mkdir(output, { recursive: true });

  for (const [width, height] of [[1280, 800], [1920, 1080]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const view of ['grid', 'list']) {
      const viewAttribute = view === 'list' ? ' data-view="list"' : '';
      const html = `<!doctype html><style>:root{--sleekfin-accent:#ff0000;--sleekfin-text:#fff;--sleekfin-surface:#222}${css}</style><div class="sleekfin-details-episode-list"${viewAttribute}><article class="sleekfin-details-episode"><button class="sleekfin-details-episode-action"><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%23267099'/%3E%3C/svg%3E"><span class="sleekfin-details-episode-shade"></span></button></article></div>`;
      const frameId = (await send('Page.getFrameTree')).frameTree.frame.id;
      await send('Page.setDocumentContent', { frameId, html });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal((await send('Runtime.evaluate', { expression: `document.activeElement.classList.contains('sleekfin-details-episode-action')`, returnByValue: true })).result.value, true);
      const clip = (await send('Runtime.evaluate', { expression: `(() => { const r=document.querySelector('.sleekfin-details-episode').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}; })()`, returnByValue: true })).result.value;
      const focused = Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip })).data, 'base64');
      const image = decodePng(focused);
      const edge = pixel(image, 2, Math.floor(image.height / 2));
      assert.ok(edge[0] > 220 && edge[1] < 60 && edge[2] < 60, `${width}x${height} ${view} keyboard-focus edge must be accent red, got ${edge}`);
      if (output) await writeFile(`${output}/focus-${view}-${width}x${height}.png`, focused);

      await send('Runtime.evaluate', { expression: `document.activeElement.blur()` });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: clip.x + clip.width / 2, y: clip.y + clip.height / 2 });
      const hovered = decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip })).data, 'base64'));
      const bareEdge = pixel(hovered, 2, Math.floor(hovered.height / 2));
      assert.ok(!(bareEdge[0] > 220 && bareEdge[1] < 60 && bareEdge[2] < 60), `${width}x${height} ${view} hover must not look keyboard-focused`);

      await send('Runtime.evaluate', { expression: `document.querySelector('.sleekfin-details-episode-action').dataset.sleekfinFocused='true'` });
      const fallback = decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip })).data, 'base64'));
      const fallbackEdge = pixel(fallback, 2, Math.floor(fallback.height / 2));
      assert.ok(fallbackEdge[0] > 220 && fallbackEdge[1] < 60 && fallbackEdge[2] < 60, `${width}x${height} ${view} legacy focus edge must be accent red`);
    }
  }
});
