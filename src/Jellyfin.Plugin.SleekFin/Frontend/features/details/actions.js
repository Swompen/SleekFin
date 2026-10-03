import { decorateNativeButton, restoreNativeButton } from '../../shared/runtime.js';

export function createActions(container, getItem) {
  const decorated = new Set();

  function reconcile() {
    const item = getItem();
    // Jellyfin crosses the two controls over their class names: the replay-icon .btnReplay carries
    // data-action="play" and starts at 0, while the play-arrow .btnPlay carries data-action="resume" and
    // is the one that resumes, which is why Jellyfin titles it ButtonResume whenever a position exists.
    // Those are Jellyfin's localized strings, so the labels here are decided from the playback position.
    const isResumable = Number(item.UserData?.PlaybackPositionTicks || 0) > 0;
    const hasEpisodeResume = item.Type === 'Episode' && isResumable;
    const buttons = container.querySelectorAll('.btnPlay, .btnReplay, .btnDownload, .btnUserRating');

    buttons.forEach((element) => {
      const isFavorite = element.classList.contains('btnUserRating');
      const isDownload = element.classList.contains('btnDownload');
      const isReplay = element.dataset.action === 'play';
      const icon = isFavorite ? (element.dataset.isfavorite === 'true' ? 'bookmarkCheck' : 'bookmark') : isDownload ? 'download' : 'play';
      const label = isFavorite ? (element.dataset.isfavorite === 'true' ? 'In watchlist' : 'Add to watchlist') : isDownload ? 'Download' : isResumable && !isReplay ? 'Resume' : 'Play';

      element.classList.toggle('sleekfin-details-suppressed-action', hasEpisodeResume && isReplay);
      decorateNativeButton(element, {
        content: element.querySelector('.detailButton-content') || element,
        icon,
        label,
        variant: icon === 'play' ? 'primary' : 'control',
      });
      decorated.add(element);
    });
  }

  const observer = new MutationObserver(reconcile);
  observer.observe(container, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-isfavorite'],
  });

  return {
    destroy() {
      observer.disconnect();
      decorated.forEach((element) => {
        element.classList.remove('sleekfin-details-suppressed-action');
        restoreNativeButton(element);
      });
      decorated.clear();
    },
    reconcile,
  };
}
