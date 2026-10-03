import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

class ClassList {
  constructor(...names) {
    this.names = new Set(names);
  }

  contains(name) {
    return this.names.has(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  toggle(name, enabled) {
    if (enabled) this.names.add(name);
    else this.names.delete(name);
  }
}

class ActionButton {
  constructor(className, action) {
    this.classList = new ClassList(className);
    this.dataset = { action };
  }

  querySelector() {
    return null;
  }
}

class MutationObserverStub {
  disconnect() {}
  observe() {}
}

globalThis.MutationObserver = MutationObserverStub;
globalThis.window = {
  SleekFinRuntime: {
    components: {
      decorateNativeButton(element, options) {
        element.decoration = options;
      },
      restoreNativeButton() {},
    },
    dom: {},
    hooks: {},
  },
};

const { createActions } = await import('../src/Jellyfin.Plugin.SleekFin/Frontend/features/details/actions.js');

function renderActions(type, playbackPositionTicks) {
  const buttons = [
    new ActionButton('btnReplay', 'play'),
    new ActionButton('btnPlay', 'resume'),
  ];
  const container = { querySelectorAll: () => buttons };
  const item = { Type: type, UserData: { PlaybackPositionTicks: playbackPositionTicks } };
  const actions = createActions(container, () => item);
  actions.reconcile();
  return { actions, buttons, item };
}

for (const type of ['Movie', 'Episode', 'Series']) {
  test(`${type} never-played and completed items show Play from playback position`, () => {
    const { actions, buttons, item } = renderActions(type, 0);
    assert.deepEqual(buttons.map((button) => button.decoration.label), ['Play', 'Play']);
    assert.equal(buttons[0].classList.contains('sleekfin-details-suppressed-action'), false);

    item.UserData = { PlaybackPositionTicks: 0, Played: true };
    actions.reconcile();
    assert.deepEqual(buttons.map((button) => button.decoration.label), ['Play', 'Play']);
    assert.equal(buttons[0].classList.contains('sleekfin-details-suppressed-action'), false);
  });

  test(`${type} partially watched items label only the resumable control Resume`, () => {
    const { buttons } = renderActions(type, 12345);
    assert.deepEqual(buttons.map((button) => button.decoration.label), ['Play', 'Resume']);
    assert.equal(buttons[0].classList.contains('sleekfin-details-suppressed-action'), type === 'Episode');
  });
}

function loadDetailsInternals() {
  const context = {
    URLSearchParams,
    Event,
    MutationObserver: MutationObserverStub,
    console,
    document: {
      body: {},
      documentElement: { classList: new ClassList() },
      dispatchEvent() {},
      querySelectorAll() { return []; },
    },
  };
  const timers = new Map();
  let timerId = 0;
  context.window = {
    ApiClient: null,
    SleekFinFeatures: {},
    clearInterval(id) { timers.delete(id); },
    clearTimeout(id) { timers.delete(id); },
    history: {
      pushState() {},
      replaceState() {},
    },
    location: { hash: '', pathname: '/', search: '' },
    setInterval(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
  };
  context.globalThis = context;
  context.__stubs = {
    createActions() {}, createEpisodes() {}, createHero() {}, createSections() {}, createSimilar() {}, loadSettings() {},
    dom: { isConnected: () => false, watchSpa: () => () => {} },
  };
  return readFile(new URL('../src/Jellyfin.Plugin.SleekFin/Frontend/features/details/index.js', import.meta.url), 'utf8').then((source) => {
    const executable = source
      .replace(/^import .*;\n/gm, '')
      .replace('const features = (window.SleekFinFeatures = window.SleekFinFeatures || {});', 'const { createActions, createEpisodes, createHero, createSections, createSimilar, loadSettings, dom } = globalThis.__stubs;\nconst features = (window.SleekFinFeatures = window.SleekFinFeatures || {});')
      .replace(/\nstart\(\);\s*$/, '\nglobalThis.__details = { load, onUserDataChanged, start, state, stop, watchApiClient, watchUserData };');
    vm.runInNewContext(executable, context, { filename: 'details/index.js' });
    return { context, details: context.__details };
  });
}

function client(id, user = 'user') {
  const subscriptions = [];
  return {
    id,
    subscriptions,
    getCurrentUserId: () => user,
    serverId: () => id,
    subscribe(types, callback) {
      const subscription = { callback, stopped: false, types };
      subscriptions.push(subscription);
      return () => { subscription.stopped = true; };
    },
  };
}

test('UserDataChanged reconciles the mounted item and ignores another user, item, or server', async () => {
  const { context, details } = await loadDetailsInternals();
  const primary = client('server-a');
  context.window.ApiClient = primary;
  Object.assign(details.state, {
    currentId: 'item-a',
    currentServerId: 'server-a',
    item: { Id: 'item-a', Type: 'Episode', UserData: { PlaybackPositionTicks: 10 } },
    started: true,
    userDataClient: primary,
  });

  details.onUserDataChanged({ Data: { UserId: 'user', UserDataList: [{ ItemId: 'item-a', PlaybackPositionTicks: 0, Played: true }] } }, primary);
  assert.deepEqual(details.state.item.UserData, { ItemId: 'item-a', PlaybackPositionTicks: 0, Played: true });
  assert.notEqual(details.state.reconcileTimer, 0);

  const applied = details.state.item.UserData;
  details.onUserDataChanged({ Data: { UserId: 'other', UserDataList: [{ ItemId: 'item-a', PlaybackPositionTicks: 99 }] } }, primary);
  details.onUserDataChanged({ Data: { UserId: 'user', UserDataList: [{ ItemId: 'other', PlaybackPositionTicks: 99 }] } }, primary);
  assert.equal(details.state.item.UserData, applied);
});

test('start, route remount, stop, and restart never duplicate UserDataChanged listeners', async () => {
  const { context, details } = await loadDetailsInternals();
  const primary = client('server-a');
  context.window.ApiClient = primary;

  details.start();
  details.watchUserData();
  details.watchUserData();
  assert.equal(primary.subscriptions.length, 1);
  assert.equal(primary.subscriptions[0].types.join(','), 'UserDataChanged');

  details.stop();
  assert.equal(primary.subscriptions[0].stopped, true);
  details.start();
  assert.equal(primary.subscriptions.length, 2);
  details.stop();
});

test('ApiClient replacement unsubscribes the old server and binds the new server', async () => {
  const { context, details } = await loadDetailsInternals();
  const first = client('server-a');
  const second = client('server-b');
  context.window.ApiClient = first;

  details.start();
  assert.equal(first.subscriptions.length, 1);
  context.window.ApiClient = second;
  assert.equal(first.subscriptions[0].stopped, true);
  assert.equal(second.subscriptions.length, 1);
  assert.equal(details.state.userDataClient, second);
  details.stop();
});

test('UserDataChanged during initial item loading requests one fresh item read', async () => {
  const { context, details } = await loadDetailsInternals();
  const resolvers = [];
  const primary = Object.assign(client('server-a'), {
    getItem() {
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  context.window.ApiClient = primary;
  Object.assign(details.state, { currentId: 'item-a', currentServerId: 'server-a', generation: 1, started: true, userDataClient: primary });

  details.load('item-a', 'server-a');
  details.onUserDataChanged({ Data: { UserId: 'user', UserDataList: [{ ItemId: 'item-a', PlaybackPositionTicks: 42 }] } }, primary);
  resolvers.shift()({ Id: 'item-a', Type: 'Movie', UserData: { PlaybackPositionTicks: 0 } });
  await Promise.resolve();
  assert.equal(resolvers.length, 1);
  resolvers.shift()({ Id: 'item-a', Type: 'Movie', UserData: { PlaybackPositionTicks: 42 } });
  await Promise.resolve();
  assert.equal(details.state.item.UserData.PlaybackPositionTicks, 42);
});
