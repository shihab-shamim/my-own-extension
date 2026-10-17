# Sequoia Tab — macOS-style New Tab for Chrome

A lightweight Manifest V3 extension that replaces Chrome's New Tab page with a calm, macOS Sonoma/Sequoia-inspired desktop: rotating wallpapers (Unsplash, your own photos, built-in gradients), a clock, a search bar, your shortcuts, your real Chrome bookmarks bar and a dock.

It only changes the New Tab page. Chrome's toolbar, address bar, tabs and settings are untouched, and the extension never modifies your bookmarks, history, passwords or browser settings.

Your 10 existing New Tab shortcuts (All Plugings, My plugin, Gmail, bplugins mail, Present sheet, Freemius, ClickUp, Support Desk, Daily Workshit, mail swarm) come pre-loaded, in the same order and with the same URL.

### Floating to-do on any website (v1.6)

On any normal website, press **Ctrl+Shift+Y** or click the Sequoia Tab toolbar button:

- The to-do list **slides in from the right, floating over the page**. It takes no space and the page doesn't move or shrink.
- Press again, press **Esc**, or click **✕** to slide it away.
- It's the same list as on the New Tab and in the side panel; changes show everywhere instantly.
- On pages where Chrome doesn't allow extensions (`chrome://` pages, the Chrome Web Store), the same button opens the **side panel** instead.

How it stays safe:

- It uses `activeTab` + `scripting`, which have no install warning. The extension can touch **only the tab where you pressed the button**, and only after you press it. There is no access to all websites and no code running on pages you don't use it on.
- The list sits in a closed Shadow DOM and an extension iframe, so the website can't read or change your tasks. The page's styles can't break it.
- The to-do page uses a per-session **dynamic URL**. Websites can't load it on their own or use it to detect the extension; Chrome refuses those requests.
- After you go to another page, press the button again to show it there. That's how `activeTab` works: no permanent access.



Your to-do list can also live in **Chrome's side panel**, on the right of any website. It stays open while you switch tabs and browse, and you can close it and bring it back any time:

- **Open / close (toggle):** click the Sequoia Tab toolbar button or press **Ctrl+Shift+Y**. Press once to open and again to close, on any site. You can also (changeable at `chrome://extensions/shortcuts`) use the ▯ button or ⋯ → *Open in side panel* on the New Tab to-do card.
- **Close:** the same button or shortcut, the panel's ✕, or ⋯ → *Close side panel*. The panel's ⋯ menu shows your shortcut and has *Change keyboard shortcut…*.
- **Updating an unpacked copy:** when the files on disk are newer than what Chrome loaded, the New Tab shows **Finish update**. One click reloads the extension and reopens a New Tab.
- It's the same list as on the New Tab. Adding, ticking, editing and deleting tasks updates both instantly.
- It uses Chrome's own side panel (`sidePanel` permission, no install warning). Nothing is injected into websites, and it works on every page, including Chrome's own pages.
- Pin the extension (puzzle icon → 📌) to keep the toolbar button handy.

### Real Google account info (v1.3, optional)

Click the round avatar, then **Connect Google account**:

- Chrome asks you once for permission to read your signed-in accounts from `accounts.google.com`. This is an *optional* permission. It isn't requested at install, and nothing is fetched until you approve.
- After that, the avatar shows your **real Google photo**. The card looks like Chrome's own: your photo, **name and email** with a ⌃ toggle, your **other signed-in accounts** (click one to make Gmail and the apps open it), **Add another account**, **Sign out of all accounts**, a **Manage your Google Account** pill, and **Disconnect from Sequoia Tab**.
- If the extension was updated but not reloaded, the card says so and offers **Open chrome://extensions**. If Google can't be reached, it shows **Try again** and the error details.
- The info comes from the same place Chrome reads it for its own account menu. It is cached on this computer only, for 15 minutes; new tabs reuse it. It is never sent anywhere else and is never included in backups. **Disconnect** deletes it and gives the permission back. If Google can't be reached, the last known account stays.
- You can also connect or disconnect in Settings → Widgets → Google bar. If you don't connect, the avatar uses a photo you uploaded instead.

### Google bar (v1.2)

The top-right corner works like Chrome's own New Tab page:

- **Gmail** and **Images** links.
- A **⋮⋮⋮ Google apps** grid with Account, Search, Maps, YouTube, Play, News, Gmail, Meet, Chat, Contacts, Drive, Calendar, Translate, Photos, Docs, Sheets, Slides, Keep, Gemini, Forms and Sites. It works with the keyboard: arrow keys move, and Esc closes.
- A round **account avatar**. Its menu has *Manage your Google Account*, *Switch account* and Gmail.

Set it up in Settings → Widgets → **Google bar**:

- **Show or hide** the bar. The bookmarks bar uses the space when it's hidden.
- **Choose which signed-in Google account** the links open (u/0, u/1…).
- **Upload a profile photo.** It's cropped to a circle and stored only on this computer.

Why upload your own photo? Showing your real Google profile picture would require signing the extension into your Google account (OAuth) and adding new permissions, so Sequoia Tab doesn't do that. The bar is made of plain links, with no Google scripts and no new permissions. App icons come from Chrome's local favicon cache.

### Productivity features (v1.1)

- **Shortcut folders (Launchpad-style).** Drop one tile onto the middle of another to make a folder, or use a tile's ⋯ menu → **Add to folder**. Click a folder to open it, then rename it, add shortcuts, reorder them, or move them back out. A folder that becomes empty disappears. **Ungroup** puts a folder's shortcuts back on the page.
- **Open all together.** A folder's **Open all** button (or ⋯ → *Open all in new tabs*) opens every shortcut in it as background tabs, so you can open Gmail, Support Desk, ClickUp and Freemius in one click. More than 15 tabs asks you first.
- **To-do list ("Today").** Add tasks with Enter, tick them off, double-click to edit, and delete them. Turn on the ↻ button to make a task **daily**: daily tasks un-tick themselves every morning. *Clear completed* removes finished one-off tasks. The card floats at the top right only when there's free space beside the clock, search and tiles; otherwise it sits below them. You can collapse it or hide it in Settings → Widgets.
  - **Move it:** drag the header or the ⠿ grip anywhere on the page.
  - **Resize it:** drag the bottom-right corner (from 240×140 px up to 640 px wide). The list scrolls when the card is short.
  - Your position and size are saved and used in every tab, and the card is always kept inside the window.
  - Keyboard: focus the grip and use the arrow keys to move it, or focus the corner and use the arrow keys to resize it. Shift moves in bigger steps.
  - Reset with ⋯ → *Reset size & position* or by double-clicking the grip. On narrow windows the card goes back below the shortcuts.
- **Backup.** Settings → Backup & Privacy → **Export backup** downloads a JSON file with your settings, shortcuts and folders, dock, favorites and to-dos. **Import backup…** restores it after asking you to confirm. The backup never includes your Unsplash key or uploaded photos. Imported data is checked the same way as data you type in (unsafe links are removed).
- **Command palette (Ctrl+K / ⌘K, or the ⌘ button bottom-right).** One box for shortcuts (including those inside folders), "Open all in <folder>", Chrome bookmarks, dock items, settings sections and actions (next wallpaper, theme, add shortcut, add task, export/import). If nothing matches, it searches the web, and an address opens directly. Use ↑/↓ and Enter; Alt+Enter opens in a new tab.

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
| Widgets | Show/hide and reorder the clock, search and shortcuts; centered or top layout; show/hide the bookmarks bar, dock, to-do list and wallpaper info; Google bar (account, profile photo) |
| Clock & Date | 12/24-hour, seconds, date format |
| Search | Chrome default engine, Google, Bing, DuckDuckGo, Brave, Ecosia, or a custom `https://…%s` URL |
| Shortcuts | Size, columns, labels; add, edit, reorder, remove; folders (open, delete); restore your original 10 |
| Dock | Position (bottom/left/right), icon size, magnification, auto-hide; add websites or Chrome pages, reorder, remove |
| Bookmarks | Show the bar; show "Other" and "Mobile" folders |
| Backup & Privacy | Export/import a backup; permission explanations; restore default settings |

**Keyboard:** `Ctrl+K` opens the command palette, `/` focuses search, `Alt+Enter` opens results in a new tab, typing an address (for example `github.com`) opens it directly. Bookmark folders open with `↓`, submenus with `→`, and `Esc` closes them. Focus a shortcut tile and press `Ctrl+Shift+←/→` to reorder it. You can also drag tiles.

## Unsplash setup

1. Sign in at <https://unsplash.com/developers> and create an app at <https://unsplash.com/oauth/applications>.
2. Copy the app's **Access Key** (not the Secret Key).
3. Go to **Settings → Wallpaper → Unsplash**, paste the key and click **Save & test**.

How the extension uses the API:

- It fetches 30 random photos per request (`/photos/random?count=30`) and shows them one at a time from a local queue.
- Each time a photo becomes your wallpaper, it sends the required download ping (`download_location`).
- Images are hotlinked from `images.unsplash.com`, as Unsplash's guidelines require. They are sized to your screen with `w=`, `q=80` and `fm=jpg`.
- The photographer and Unsplash are credited bottom-left with `utm_source=sequoia_tab&utm_medium=referral` links. This is on by default. Settings → Widgets → **Unsplash photo credit** can turn it off, but that breaks Unsplash's API rules and may get your key revoked.

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
| `sidePanel` | Shows the to-do list in Chrome's side panel. No install warning |
| `activeTab`, `scripting` | When you press the toolbar button / Ctrl+Shift+Y on a website, shows the floating to-do on **that tab only**. No install warning, no access to other sites |
| `declarativeNetRequestWithHostAccess` | No install warning, and it only works on sites you granted. For the single account-list request, it sends `Origin: https://www.google.com` (exactly what Chrome's own account menu sends) instead of the extension's origin, because Google rejects (403) requests carrying an extension origin. It is limited to that one URL, POST requests and this extension's own requests |
| `https://accounts.google.com/*` (**optional**) | Only if you click *Connect Google account*: reads your signed-in Google accounts (name, email, photo) to show them in the account card. It isn't requested at install, and *Disconnect* removes it |
| `search` | Lets *Chrome default* search with the engine you chose in Chrome settings |

No host permissions, no `tabs`, no `history`, no content scripts. Uploaded photos live in the extension's IndexedDB.

## Network requests

The extension contacts only these hosts, and only when you turn on the related feature:

- `api.unsplash.com` for random photos and download pings, using your key (Unsplash wallpapers only).
- `images.unsplash.com` for the wallpaper images themselves (Unsplash wallpapers only).
- `accounts.google.com` for your signed-in account list, at most every 15 minutes or when you open the account card (only after *Connect Google account*).
- `lh3.googleusercontent.com` for your Google profile photos (only after *Connect Google account*).

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
  shortcut-model.js      Pure folder/shortcut operations + import validation
  todo-model.js          To-do helpers (daily reset, validation)
  storage.js             chrome.storage.local helpers
  rotation.js            Wallpaper selection/rotation engine (serialised, timestamp based)
  unsplash.js            Unsplash client, sanitising, attribution helpers
  idb.js                 IndexedDB store for uploaded photos
  presets.js             Built-in CSS wallpapers, colour/brightness helpers
  url.js, icons.js       URL validation/navigation, SVG icons
src/newtab/              Page modules (main, store, wallpaper-view, clock, search,
                         shortcuts, folder-view, tiles, todo, palette, backup,
                         bookmarks, dock, menu, settings, uploads, ui…)
tests/                   Puppeteer end-to-end suite (not part of the packaged zip)
```

## Running the tests

```bash
cd tests
npm install        # downloads Puppeteer + Chrome for Testing
npm test           # about 18 minutes: e2e.js (core, incl. a real 1-minute
                   # rotation wait), features.js (folders, to-do, backup,
                   # palette), gbar.js (Google bar), gaccount.js (account card),
                   # todo-layout.js (move/resize the to-do card)
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
