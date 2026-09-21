// popup.js — handles the extension popup UI

// ─── DOM refs ───
const streamerInput  = document.getElementById('streamerInput');
const addBtn         = document.getElementById('addBtn');
const addError       = document.getElementById('addError');
const streamerList   = document.getElementById('streamerList');
const countEl        = document.getElementById('count');
const notifToggle    = document.getElementById('notificationsToggle');
const endToggle      = document.getElementById('endStreamToggle');
const connectionDot  = document.getElementById('connectionStatus');
const statusText     = document.getElementById('statusText');
const checkNowBtn    = document.getElementById('checkNowBtn');

// ─── helpers ───
function showError(msg) {
  addError.textContent = msg;
  addError.classList.remove('hidden');
}

function clearError() {
  addError.classList.add('hidden');
}

function sanitizeName(name) {
  return name.trim().replace(/^@/, '');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── render ───
async function render() {
  try {
    const state = await chrome.runtime.sendMessage({ action: 'getState' });
    if (!state || state.error) {
      streamerList.innerHTML = '<li class="empty-state">Error loading state</li>';
      return;
    }

    const { streamers = [], liveMap = {}, settings = {} } = state;

    countEl.textContent = streamers.length;

    if (streamers.length === 0) {
      streamerList.innerHTML = '<li class="empty-state">No streamers added yet</li>';
    } else {
      streamerList.innerHTML = '';
      for (const s of streamers) {
        const live = !!liveMap[s.login];
        const details = liveMap[s.login] || {};
        const li = document.createElement('li');
        li.className = 'streamer-item';
        li.innerHTML =
          '<div class="streamer-info">' +
            '<img class="streamer-avatar" src="' + escapeHtml(s.avatar) + '" alt="" loading="lazy">' +
            '<div>' +
              '<div class="streamer-name">' +
                (live ? '<span class="live-indicator"></span>' : '') +
                escapeHtml(s.displayName) +
              '</div>' +
              '<div class="streamer-status">' +
                (live
                  ? escapeHtml(details.title || details.game || 'Live')
                  : 'Offline'
                ) +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button class="remove-btn" data-login="' + escapeHtml(s.login) + '" title="Remove">\u2715</button>';
        streamerList.appendChild(li);
      }

      // attach remove handlers
      streamerList.querySelectorAll('.remove-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          await chrome.runtime.sendMessage({ action: 'removeStreamer', login: btn.dataset.login });
          await fullRender();
        });
      });
    }

    // settings
    notifToggle.checked = settings.notifications !== false;
    endToggle.checked = settings.endStream !== false;

    // status dot
    var anyLive = Object.keys(liveMap).length > 0;
    connectionDot.className = 'status-dot ' + (anyLive ? 'online' : 'offline');
    statusText.textContent = anyLive ? 'Live' : 'All offline';
  } catch (e) {
    console.error('render error:', e);
  }
}

async function fullRender() {
  await render();
}

// ─── add streamer ───
async function addStreamer(rawName) {
  clearError();
  var username = sanitizeName(rawName);

  if (!username) {
    showError('Enter a username.');
    return;
  }

  try {
    var resp = await chrome.runtime.sendMessage({ action: 'addStreamer', login: username });
    if (resp.error) {
      showError(resp.error);
      return;
    }
    streamerInput.value = '';
    await fullRender();
  } catch (e) {
    showError('Failed to reach background worker. Try reloading the extension.');
  }
}

// ─── event handlers ───
addBtn.addEventListener('click', function() {
  addStreamer(streamerInput.value);
});

streamerInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') addStreamer(streamerInput.value);
});

notifToggle.addEventListener('change', async function() {
  await chrome.runtime.sendMessage({ action: 'toggleNotifications' });
  await fullRender();
});

endToggle.addEventListener('change', async function() {
  await chrome.runtime.sendMessage({ action: 'toggleEndNotifications' });
  await fullRender();
});

checkNowBtn.addEventListener('click', async function() {
  checkNowBtn.textContent = 'Checking...';
  checkNowBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ action: 'refresh' });
  } catch (e) { /* ignore */ }
  setTimeout(async function() {
    await fullRender();
    checkNowBtn.textContent = 'Check Now';
    checkNowBtn.disabled = false;
  }, 2000);
});

// ─── listen for status updates from background ───
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.type === 'STATUS_CHANGED') {
    fullRender();
  }
});

// ─── init ───
fullRender();
