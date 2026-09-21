# Twitch Stream Notifier

A lightweight Manifest V3 Chrome extension that checks Twitch channels and notifies you when they go live or end their stream.

## Features

- Track multiple Twitch usernames.
- Show live status, stream title, game, and avatar.
- Notify when a tracked channel goes live.
- Optionally notify when a stream ends.
- Open the channel directly from a notification.
- Poll every two minutes, with a manual **Check Now** action.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this folder.
5. Open the extension and add Twitch usernames.

## Data and privacy

The extension stores the tracked-channel list and notification settings in Chrome local storage. It does not collect or transmit personal information to the project author.

Channel status, title, game, and avatar lookups use [DecAPI](https://decapi.me/), a third-party Twitch data proxy. Twitch usernames entered into the extension are sent to that service so the extension can perform the requested lookups. Review DecAPI’s availability and privacy terms before installing it in a sensitive environment.

No Twitch login or client secret is required.

## Permissions

- `storage` stores the local channel list and settings.
- `alarms` schedules the two-minute status checks.
- `notifications` displays live/offline alerts.
- `https://decapi.me/*` allows the extension to query DecAPI.

## Limitations

Status accuracy depends on DecAPI being available. If the proxy is temporarily unavailable, the extension keeps the last known live/offline state and avoids sending a false offline notification.

## License

MIT. See [LICENSE](LICENSE).
