const EPISODE_SELECTOR = '.sleekfin-details-episode-action';

function episodeButtons(list) {
  return Array.from(list.querySelectorAll(EPISODE_SELECTOR));
}

function episodeKey(event) {
  if (event.key) return event.key;
  return {
    13: 'Enter',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
  }[event.keyCode || event.which] || '';
}

function episodeId(button) {
  return button.dataset.episodeId || '';
}

function setActiveEpisode(list, active, focus = false) {
  const buttons = episodeButtons(list);
  for (const button of buttons) {
    button.tabIndex = button === active ? 0 : -1;
    if (button !== active) delete button.dataset.sleekfinFocused;
  }
  if (!active) return;
  list.dataset.sleekfinActiveEpisodeId = episodeId(active);
  if (focus) {
    active.dataset.sleekfinFocused = 'true';
    active.focus();
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function center(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function directionalTarget(buttons, current, key) {
  const origin = center(current.getBoundingClientRect());
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const positive = key === 'ArrowRight' || key === 'ArrowDown';
  let nearest = null;
  let nearestScore = Infinity;

  for (const candidate of buttons) {
    if (candidate === current) continue;
    const position = center(candidate.getBoundingClientRect());
    const primary = horizontal ? position.x - origin.x : position.y - origin.y;
    if ((positive && primary <= 0) || (!positive && primary >= 0)) continue;
    const secondary = horizontal ? Math.abs(position.y - origin.y) : Math.abs(position.x - origin.x);
    const score = Math.abs(primary) + secondary * 2;
    if (score < nearestScore) {
      nearest = candidate;
      nearestScore = score;
    }
  }

  return nearest;
}

export function syncEpisodeNavigation(list, { restoreFocus = false } = {}) {
  const buttons = episodeButtons(list);
  const activeId = list.dataset.sleekfinActiveEpisodeId;
  const active = buttons.find((button) => episodeId(button) === activeId) || buttons[0] || null;
  setActiveEpisode(list, active, restoreFocus && Boolean(active));
}

export function installEpisodeNavigation(list) {
  function episodeAction(target) {
    const action = target?.closest?.(EPISODE_SELECTOR);
    return action && list.contains(action) ? action : null;
  }

  function handleFocusIn(event) {
    const action = episodeAction(event.target);
    if (!action) return;
    setActiveEpisode(list, action);
    action.dataset.sleekfinFocused = 'true';
    action.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function handleFocusOut(event) {
    const action = episodeAction(event.target);
    if (action) delete action.dataset.sleekfinFocused;
  }

  function handleKeyDown(event) {
    const action = episodeAction(event.target);
    if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = episodeKey(event);
    if (key === 'Enter') {
      event.preventDefault();
      action.click();
      return;
    }
    if (!key.startsWith('Arrow')) return;
    const next = directionalTarget(episodeButtons(list), action, key);
    if (!next) return;
    event.preventDefault();
    setActiveEpisode(list, next, true);
  }

  list.addEventListener('focusin', handleFocusIn);
  list.addEventListener('focusout', handleFocusOut);
  list.addEventListener('keydown', handleKeyDown);

  return () => {
    list.removeEventListener('focusin', handleFocusIn);
    list.removeEventListener('focusout', handleFocusOut);
    list.removeEventListener('keydown', handleKeyDown);
  };
}
