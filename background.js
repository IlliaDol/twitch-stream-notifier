// Twitch Stream Notifier — background service worker
// Uses DecAPI (https://decapi.me) — a public Twitch proxy, zero auth required.

const DECAPI = 'https://decapi.me/twitch';
const CHECK_INTERVAL_MINUTES = 2;

// ─── Storage keys ────────────────────────────────────────────────────
// streamers: [{login, displayName, avatar, live, title, game, lastGame}]
// liveMap:   {[login]: {title, game}}
// settings:  {notifications: bool, endStream: bool}

// ─── DecAPI helpers ──────────────────────────────────────────────────

async function decapi(endpoint) {
  try {
    const res = await fetch(`${DECAPI}/${endpoint}`);
    return res.ok ? (await res.text()).trim() : null;
  } catch (e) {
    console.error(`[TwitchNotifier] DecAPI ${endpoint}:`, e.message);
    return null;
  }
}

// Returns truthy uptime string if live, null/falsey if offline or error.
// Live: "1 hour, 23 minutes" / Offline: "user is offline" or null
async function isLive(login) {
  const uptime = await decapi(`uptime/${encodeURIComponent(login)}`);
  // null means the service could not be reached; false means Twitch replied
  // that the channel is offline. Keeping these states separate prevents a
  // temporary API outage from generating false "went offline" notifications.
  if (uptime === null) return null;
  if (!uptime) return false;
  return !uptime.toLowerCase().includes('offline');
}

async function getAvatar(login) {
  const url = await decapi(`avatar/${encodeURIComponent(login)}`);
  // avatar returns "User not found" for non-existent users
  if (!url || !url.startsWith('http')) return null;
  return url;
}

async function getTitle(login) {
  const title = await decapi(`title/${encodeURIComponent(login)}`);
  if (!title || title.includes('not found') || title.includes('offline')) return null;
  return title;
}

async function getGame(login) {
  const game = await decapi(`game/${encodeURIComponent(login)}`);
  if (!game || game.includes('not found') || game.includes('offline')) return null;
  return game;
}

function notifyPopup() {
  // The popup is optional and may be closed while the service worker runs.
  chrome.runtime.sendMessage({ type: 'STATUS_CHANGED' }).catch(() => {});
}

// ─── Main polling routine ────────────────────────────────────────────
async function poll() {
  const store = await chrome.storage.local.get(['streamers', 'liveMap', 'settings']);
  const streamers = store.streamers || [];
  const liveMap = store.liveMap || {};
  const settings = store.settings || { notifications: true, endStream: true };

  if (streamers.length === 0) {
    chrome.action.setBadgeText({ text: '' });
    await chrome.storage.local.set({ liveMap: {} });
    notifyPopup();
    return;
  }

  // Check all streamers in parallel
  const checks = await Promise.all(streamers.map(async (s) => {
    const live = await isLive(s.login);
    return { login: s.login, live };
  }));

  const prevLiveSet = new Set(Object.keys(liveMap));
  // Preserve the last known state when the proxy is temporarily unavailable.
  const nowLiveSet = new Set(checks
    .filter(c => c.live === true || (c.live === null && prevLiveSet.has(c.login)))
    .map(c => c.login));

  // ── Notifications ───────────────────────────────────────────────
  if (settings.notifications) {
    for (const c of checks) {
      if (c.live !== true) continue;

      // Newly live?
      if (!prevLiveSet.has(c.login)) {
        const s = streamers.find(st => st.login === c.login);
        const name = s?.displayName || s.login;

        // Fetch title + game for the notification
        const [title, game] = await Promise.all([getTitle(c.login), getGame(c.login)]);

        chrome.notifications.create(`live-${c.login}`, {
          type: 'basic',
          iconUrl: s?.avatar || 'icons/icon128.png',
          title: `\u{1F534} ${name} is now live!`,
          message: [title, game ? `Playing: ${game}` : ''].filter(Boolean).join('\n'),
          priority: 2,
          buttons: [{ title: 'Watch on Twitch' }],
          requireInteraction: false,
        });
      }
    }

    // Went offline?
    if (settings.endStream) {
      for (const oldLogin of prevLiveSet) {
        const check = checks.find(c => c.login === oldLogin);
        if (check?.live === false && !nowLiveSet.has(oldLogin)) {
          const s = streamers.find(st => st.login === oldLogin);
          const name = s?.displayName || oldLogin;

          chrome.notifications.create(`offline-${oldLogin}`, {
            type: 'basic',
            iconUrl: s?.avatar || 'icons/icon128.png',
            title: `\u26AB ${name} went offline`,
            message: 'Stream ended.',
            priority: 1,
          });
        }
      }
    }
  }

  // Update streamers live status + re-fetch titles for currently live
  await Promise.all(streamers.map(async (s) => {
    const check = checks.find(c => c.login === s.login);
    const nowLive = check?.live === null ? !!s.live : nowLiveSet.has(s.login);
    if (nowLive && !s.live) {
      // Just went live — update title/game
      const [title, game] = await Promise.all([getTitle(s.login), getGame(s.login)]);
      s.title = title || '';
      s.game = game || '';
    } else if (!nowLive && s.live) {
      s.lastGame = s.game || s.lastGame;
      s.title = '';
      s.game = '';
    }
    s.live = nowLive;
  }));

  // Build this after transition updates so the popup gets current details.
  const newLiveMap = {};
  for (const s of streamers) {
    if (s.live) {
      newLiveMap[s.login] = { title: s.title || '', game: s.game || '' };
    }
  }

  await chrome.storage.local.set({ liveMap: newLiveMap, streamers });

  // ── Badge ───────────────────────────────────────────────────────
  const liveCount = Object.keys(newLiveMap).length;
  chrome.action.setBadgeText({ text: liveCount > 0 ? String(liveCount) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#9146FF' });
  notifyPopup();
}

// ─── Notification clicks → open Twitch ───────────────────────────────
chrome.notifications.onClicked.addListener((notifId) => {
  const login = notifId.replace(/^(live|offline)-/, '');
  chrome.tabs.create({ url: `https://twitch.tv/${login}` });
});

chrome.notifications.onButtonClicked.addListener((notifId) => {
  const login = notifId.replace(/^(live|offline)-/, '');
  chrome.tabs.create({ url: `https://twitch.tv/${login}` });
});

// ─── Alarm ───────────────────────────────────────────────────────────
chrome.alarms.create('pollStreams', { periodInMinutes: CHECK_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollStreams') poll();
});

// ─── Lifecycle ───────────────────────────────────────────────────────
chrome.runtime.onStartup.addListener(() => setTimeout(poll, 2000));
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#9146FF' });
  setTimeout(poll, 1000);
});

// ─── Message bridge ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {

        case 'addStreamer': {
          const login = (msg.login || '').trim().toLowerCase();
          if (!login) { sendResponse({ error: 'Empty username.' }); return; }
          if (!/^[a-z0-9_]{1,25}$/.test(login)) {
            sendResponse({ error: 'Invalid Twitch username format.' });
            return;
          }

          const streamers = (await chrome.storage.local.get('streamers')).streamers || [];
          if (streamers.some(s => s.login === login)) {
            sendResponse({ error: 'Already tracked.' });
            return;
          }

          // Verify user exists by checking avatar
          const avatar = await getAvatar(login);
          if (!avatar) {
            sendResponse({ error: 'Streamer not found on Twitch.' });
            return;
          }

          // Check live status + details
          const [live, title, game] = await Promise.all([
            isLive(login),
            getTitle(login),
            getGame(login),
          ]);

          const entry = {
            login,
            displayName: login.charAt(0).toUpperCase() + login.slice(1),
            avatar,
            live,
            title: title || '',
            game: game || '',
            lastGame: '',
          };

          streamers.push(entry);
          await chrome.storage.local.set({ streamers });

          if (live) {
            const liveMap = (await chrome.storage.local.get('liveMap')).liveMap || {};
            liveMap[login] = { title: title || '', game: game || '' };
            await chrome.storage.local.set({ liveMap });
            chrome.action.setBadgeText({ text: String(Object.keys(liveMap).length) });
          }

          sendResponse({ success: true, streamer: entry });
          break;
        }

        case 'removeStreamer': {
          const store = await chrome.storage.local.get(['streamers', 'liveMap']);
          const streamers = store.streamers || [];
          const liveMap = store.liveMap || {};

          const idx = streamers.findIndex(s => s.login === msg.login);
          if (idx === -1) { sendResponse({ error: 'Not found.' }); return; }

          const [removed] = streamers.splice(idx, 1);
          delete liveMap[removed.login];
          await chrome.storage.local.set({ streamers, liveMap });

          const liveCount = Object.keys(liveMap).length;
          chrome.action.setBadgeText({ text: liveCount > 0 ? String(liveCount) : '' });

          sendResponse({ success: true });
          break;
        }

        case 'getState': {
          const store = await chrome.storage.local.get(['streamers', 'liveMap', 'settings']);
          sendResponse({
            streamers: store.streamers || [],
            liveMap: store.liveMap || {},
            settings: store.settings || { notifications: true, endStream: true },
          });
          break;
        }

        case 'refresh': {
          await poll();
          sendResponse({ success: true });
          break;
        }

        case 'toggleNotifications': {
          const settings = (await chrome.storage.local.get('settings')).settings || { notifications: true, endStream: true };
          settings.notifications = !settings.notifications;
          await chrome.storage.local.set({ settings });
          sendResponse({ settings });
          break;
        }

        case 'toggleEndNotifications': {
          const settings = (await chrome.storage.local.get('settings')).settings || { notifications: true, endStream: true };
          settings.endStream = !settings.endStream;
          await chrome.storage.local.set({ settings });
          sendResponse({ settings });
          break;
        }

        default:
          sendResponse({ error: `Unknown action: ${msg.action}` });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();
  return true;
});
