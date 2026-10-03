import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { installEpisodeNavigation, syncEpisodeNavigation } from '../src/Jellyfin.Plugin.SleekFin/Frontend/features/details/episode-navigation.js';

class EpisodeButton {
  constructor(id, left, top) {
    this.dataset = { episodeId: id };
    this.left = left;
    this.top = top;
    this.tabIndex = -1;
    this.clicks = 0;
    this.focuses = 0;
  }

  click() {
    this.clicks += 1;
  }

  closest(selector) {
    return selector === '.sleekfin-details-episode-action' ? this : null;
  }

  focus() {
    this.focuses += 1;
  }

  getBoundingClientRect() {
    return { left: this.left, right: this.left + 100, top: this.top, bottom: this.top + 50, width: 100, height: 50 };
  }

  scrollIntoView(options) {
    this.scrollOptions = options;
  }
}

class EpisodeList {
  constructor(buttons) {
    this.buttons = buttons;
    this.dataset = {};
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  contains(target) {
    return this.buttons.includes(target);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.(event);
  }

  querySelectorAll() {
    return this.buttons;
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }
}

function keyboardEvent(target, key, keyCode = 0) {
  return {
    target,
    key,
    keyCode,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function createGrid() {
  return new EpisodeList([
    new EpisodeButton('1', 0, 0),
    new EpisodeButton('2', 120, 0),
    new EpisodeButton('3', 0, 70),
    new EpisodeButton('4', 120, 70),
  ]);
}

test('Arrow keys move focus in all four directions and keep one roving tab stop', () => {
  const list = createGrid();
  installEpisodeNavigation(list);
  syncEpisodeNavigation(list);

  assert.deepEqual(list.buttons.map((button) => button.tabIndex), [0, -1, -1, -1]);

  const right = keyboardEvent(list.buttons[0], 'ArrowRight');
  list.dispatch('keydown', right);
  assert.equal(right.prevented, true);
  assert.equal(list.buttons[1].focuses, 1);

  const down = keyboardEvent(list.buttons[1], 'ArrowDown');
  list.dispatch('keydown', down);
  assert.equal(list.buttons[3].focuses, 1);

  const left = keyboardEvent(list.buttons[3], 'ArrowLeft');
  list.dispatch('keydown', left);
  assert.equal(list.buttons[2].focuses, 1);

  const up = keyboardEvent(list.buttons[2], 'ArrowUp');
  list.dispatch('keydown', up);
  assert.equal(list.buttons[0].focuses, 1);
  assert.deepEqual(list.buttons.map((button) => button.tabIndex), [0, -1, -1, -1]);
  assert.deepEqual(list.buttons[0].scrollOptions, { block: 'nearest', inline: 'nearest' });
});

test('focus events expose a scoped visible-focus marker', () => {
  const list = createGrid();
  installEpisodeNavigation(list);

  list.dispatch('focusin', { target: list.buttons[1] });
  assert.equal(list.buttons[1].dataset.sleekfinFocused, 'true');
  assert.deepEqual(list.buttons.map((button) => button.tabIndex), [-1, 0, -1, -1]);

  list.dispatch('focusout', { target: list.buttons[1] });
  assert.equal('sleekfinFocused' in list.buttons[1].dataset, false);
});

test('Enter and keyCode-only remote OK activate the focused episode once', () => {
  const list = createGrid();
  installEpisodeNavigation(list);

  const enter = keyboardEvent(list.buttons[0], 'Enter');
  list.dispatch('keydown', enter);
  assert.equal(enter.prevented, true);
  assert.equal(list.buttons[0].clicks, 1);

  const remoteOk = keyboardEvent(list.buttons[0], '', 13);
  list.dispatch('keydown', remoteOk);
  assert.equal(remoteOk.prevented, true);
  assert.equal(list.buttons[0].clicks, 2);
});

test('season re-render restores focus to the first new episode and resets roving tabindex', () => {
  const list = createGrid();
  syncEpisodeNavigation(list);
  list.dataset.sleekfinActiveEpisodeId = '2';
  list.buttons = [new EpisodeButton('season-2-1', 0, 0), new EpisodeButton('season-2-2', 120, 0)];

  syncEpisodeNavigation(list, { restoreFocus: true });

  assert.deepEqual(list.buttons.map((button) => button.tabIndex), [0, -1]);
  assert.equal(list.buttons[0].focuses, 1);
});

test('pointer click behavior remains native and unrelated keys are not intercepted', () => {
  const list = createGrid();
  installEpisodeNavigation(list);

  list.buttons[2].click();
  const escape = keyboardEvent(list.buttons[2], 'Escape');
  list.dispatch('keydown', escape);

  assert.equal(list.buttons[2].clicks, 1);
  assert.equal(escape.prevented, false);
});

test('episode list lifecycle installs and re-syncs navigation after rendering', async () => {
  const source = await readFile(new URL('../src/Jellyfin.Plugin.SleekFin/Frontend/features/details/episodes.jsx', import.meta.url), 'utf8');
  assert.match(source, /installEpisodeNavigation\(list\)/);
  assert.match(source, /syncEpisodeNavigation\(list,/);
});

test('episode focus marker has a visible authored style', async () => {
  const source = await readFile(new URL('../src/Jellyfin.Plugin.SleekFin/Inject/Details/sleekfin-details-episodes.css', import.meta.url), 'utf8');
  assert.match(source, /\.sleekfin-details-episode-action\[data-sleekfin-focused="true"\]/);
  assert.match(source, /box-shadow:/);
});
