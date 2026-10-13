# Sequoia Tab — macOS-style New Tab for Chrome

A lightweight Manifest V3 extension that replaces Chrome's New Tab page with a calm, macOS Sonoma/Sequoia-inspired desktop: rotating wallpapers (Unsplash, your own photos, built-in gradients), a clock, a search bar, your shortcuts, your real Chrome bookmarks bar and a dock.

It only changes the New Tab page. Chrome's toolbar, address bar, tabs and settings are untouched, and the extension never modifies your bookmarks, history, passwords or browser settings.

Your 10 existing New Tab shortcuts (All Plugings, My plugin, Gmail, bplugins mail, Present sheet, Freemius, ClickUp, Support Desk, Daily Workshit, mail swarm) come pre-loaded, in the same order and with the same URLs.

---

## Install

1. Unzip `sequoia-tab-1.0.0.zip` (or use this folder as-is).
2. Open `chrome://extensions` and turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Open a new tab. Chrome may ask *"Change back to Google?"*. Choose **Keep it** to use Sequoia Tab.

No build step is needed. The extension is plain HTML, CSS and ES modules.

## Configure

Click the **gear** (bottom-right) or the **Customize** icon in the dock. All changes apply instantly and are saved in `chrome.storage.local`.

| Section | What you can change |
|---|---|
| Wallpaper | Source (Unsplash, My Photos, Favorites, Built-in, Gradient, Solid Color), rotation interval (1 min, 5 min, 15 min, 30 min, 1 h, Daily, Disabled), pause, *Next now*, Unsplash key, categories and keywords, uploads gallery (set default, remove), dim overlay, blur |
| Appearance | Auto/Light/Dark theme, text colour over the wallpaper (auto-detected from brightness, or forced), glass transparency, corner radius, animation level, reduce motion |
| Widgets | Show/hide and reorder the clock, search and shortcuts; centered or top layout; show/hide the bookmarks bar, dock and wallpaper info |
| Clock & Date | 12/24-hour, seconds, date format |
| Search | Chrome default engine, Google, Bing, DuckDuckGo, Brave, Ecosia, or a custom `https://…%s` URL |
| Shortcuts | Size, columns, labels; add, edit, reorder, remove; restore your original 10 |
| Dock | Position (bottom/left/right), icon size, magnification, auto-hide; add websites or Chrome pages, reorder, remove |
| Bookmarks | Show the bar; show "Other" and "Mobile" folders |
| Privacy & Reset | Permission explanations; restore default settings |

**Keyboard:** `/` focuses search, `Alt+Enter` opens results in a new tab, typing an address (for example `github.com`) opens it directly. Bookmark folders open with `↓`, submenus with `→`, and `Esc` closes them. Focus a shortcut tile and press `Ctrl+Shift+←/→` to reorder it. You can also drag tiles.

## Unsplash setup

1. Sign in at <https://unsplash.com/developers> and create an app at <https://unsplash.com/oauth/applications>.
2. Copy the app's **Access Key** (not the Secret Key).
3. Go to **Settings → Wallpaper → Unsplash**, paste the key and click **Save & test**.

How the extension uses the API:

- It fetches 30 random photos per request (`/photos/random?count=30`) and shows them one at a time from a local queue.
- Each time a photo becomes your wallpaper, it sends the required download ping (`download_location`).
- Images are hotlinked from `images.unsplash.com`, as Unsplash's guidelines require. They are sized to your screen with `w=`, `q=80` and `fm=jpg`.
- The photographer and Unsplash are credited bottom-left with `utm_source=sequoia_tab&utm_medium=referral` links. This credit always shows for Unsplash photos, even when wallpaper info is hidden.

**Rate limits:** demo apps get 50 requests per hour. Each wallpaper change costs about 1.03 requests (the download ping plus 1/30 of a batch). If you want 1-minute rotation, request production approval from Unsplash (5,000 requests per hour) or use a 5-minute or longer interval. Rotation only runs while a New Tab is open, so real usage is usually far lower. If you hit the limit, the current wallpaper stays and the extension waits 15 minutes before retrying.

### Personal vs. publicly distributed builds (important)

- **Personal use (this build):** each user enters their own Access Key at runtime. It is stored only in `chrome.storage.local` on that computer and sent only to `api.unsplash.com`. No key appears anywhere in the source code. This is the right setup for an unpacked or private extension.
- **Public Chrome Web Store release:** don't ship a key inside the extension. Every installed copy would share one 50/hour quota, and anyone could extract the key from the package. Instead, either keep the bring-your-own-key flow, or run a small server-side proxy (for example a Cloudflare Worker) that holds the key, enforces rate limits and forwards `/photos/random` and download pings. Then point `API` in `src/lib/unsplash.js` at that proxy. Also apply for Unsplash production access, and use your app name as `APP_NAME` in the UTM parameters.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Saves settings, shortcuts, dock items, favorites and wallpaper state on this device |
| `bookmarks` | **Reads** your bookmarks bar and folders. The code never calls `create`, `update`, `move` or `remove`. Chrome's install prompt says "read and change" because it has no read-only bookmarks permission. |
| `alarms` | Wakes the service worker to rotate wallpapers on schedule |
| `favicon` | Shows site icons from Chrome's local favicon cache (no requests to the sites) |
| `search` | Lets *Chrome default* search with the engine you chose in Chrome settings |

No host permissions, no `tabs`, no `history`, no content scripts. Uploaded photos live in the extension's IndexedDB.

## Network requests

The extension contacts only these hosts, and only when you use Unsplash wallpapers:

- `api.unsplash.com` for random photos and download pings, using your key.
- `images.unsplash.com` for the wallpaper images themselves.

There is no analytics, telemetry or remote code. Built-in wallpapers, gradients, colors and uploads work fully offline.

## How rotation stays reliable

Chrome suspends extension service workers whenever it wants, so the extension never relies on `setInterval`. Instead:

- The time of the last change (`changedAt`) is saved in storage. "Is a change due?" is recalculated from that timestamp whenever a New Tab opens or becomes visible, when a `chrome.alarms` alarm fires (scheduled for `changedAt + interval`), and when a visible tab's own timer reaches the due time.
- The service worker is the single place that decides on changes, and it handles requests one at a time. Five tabs opening at once still produce at most one API call and one change, and every tab shows the same wallpaper through `storage.onChanged`.
- The alarm handler skips the work if no New Tab is open, to save API quota. The next tab you open catches up immediately, because "due" comes from the timestamp.
- **Daily** rotation changes the first time you open a tab after local midnight.
- **While Chrome is closed, nothing runs.** The wallpaper updates on the first New Tab after Chrome starts, if a change is due.

## Project structure

```
manifest.json            MV3 manifest (newtab override, module service worker)
newtab.html              New Tab page shell
styles/newtab.css        All styles (glass, dock, menus, settings, responsive)
icons/                   Extension icons
src/background.js        Service worker: seeding, alarms, messages, storage reactions
src/lib/                 Shared modules
  defaults.js            Settings schema, defaults, your 10 shortcuts, dock defaults
  storage.js             chrome.storage.local helpers
  rotation.js            Wallpaper selection/rotation engine (serialised, timestamp based)
  unsplash.js            Unsplash client, sanitising, attribution helpers
  idb.js                 IndexedDB store for uploaded photos
  presets.js             Built-in CSS wallpapers, colour/brightness helpers
  url.js, icons.js       URL validation/navigation, SVG icons
src/newtab/              Page modules (main, store, wallpaper-view, clock, search,
                         shortcuts, bookmarks, dock, menu, settings, uploads, ui…)
tests/                   Puppeteer end-to-end suite (not part of the packaged zip)
```

## Running the tests

```bash
cd tests
npm install        # downloads Puppeteer + Chrome for Testing
npm test           # about 4 minutes (includes a real 1-minute rotation wait)
```

Branded Chrome 137+ no longer allows `--load-extension`, so the suite uses Chrome for Testing. Unsplash success paths are mocked inside the service worker. The invalid-key test makes a real request to Unsplash.

## Troubleshooting

- **Chrome still shows its own New Tab.** Make sure the extension is enabled. If Chrome asked "Change back to Google?" and you chose that, disable and re-enable the extension.
- **Search box doesn't have focus when the tab opens.** Chrome deliberately puts focus in the address bar on new tabs. Press `/`, or click the box.
- **Shortcut icons show letters.** Icons come from Chrome's local favicon cache. They appear once you've visited the site in this profile, and you can set a custom icon URL from the shortcut's **Edit…** menu.
- **"Unsplash rejected the Access Key".** Paste the *Access Key*, not the Secret Key, and check that the app is active on unsplash.com.
- **"Rate limit reached".** Wait for the hourly reset, lengthen the interval, or switch to Favorites, which rotates saved photos without new batch requests.
- **"You're offline".** The current wallpaper stays. The new one loads automatically when you reconnect.
- **A bookmarklet does nothing.** `javascript:` bookmarks can't run from extension pages (Chrome security rule). Use them from the regular bookmarks bar instead.
- **Reset everything.** Use Settings → Privacy & Reset → Restore default settings (keeps shortcuts, photos and key), or remove and re-add the extension.
