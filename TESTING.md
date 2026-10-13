# Testing report — Sequoia Tab 1.4.2

**Date:** 2026-10-13
**Environment:** Windows 11 Pro, Chrome for Testing 148.0.7778.97 driven by Puppeteer 24. Branded Chrome 155 is installed, but it no longer accepts `--load-extension`, so automated runs use Chrome for Testing.
**Suite:** `tests/e2e.js`, the real extension loaded unpacked
**Result:** **230 / 230 checks passed** on 1.4.2: `e2e.js` 87/87 (re-run after the last fix), `features.js` 62/62, `gbar.js` 23/23, `gaccount.js` 34/34, `todo-layout.js` 24/24. The last four ran on identical code except for a one-line fix in `main.js` that only adds the credit switch to the attribution redraw list.

## Verified functionality (spec §10)

| # | Requirement | Result | How it was verified |
|---|---|---|---|
| 1 | Installs and loads without manifest errors | ✅ | Service worker registers. `chrome://newtab` resolves to `newtab.html`. MV3 manifest with only `storage, bookmarks, alarms, favicon, search`, and no host permissions |
| 2 | New Tab renders correctly | ✅ | All 10 original shortcuts present with **exact** titles and URLs, on one row at 1280 px. Screenshots reviewed in light and dark themes |
| 3 | Bookmarks unchanged and usable | ✅ | Full bookmark tree is identical before and after use. The bar shows live updates when bookmarks change in Chrome. Overflow moves into a `»` menu. "Other bookmarks" folder shown |
| 4 | Folders open and navigate | ✅ | `↓` opens a folder, `→` opens a nested submenu, `Esc` closes and returns focus. Clicking a bookmark navigates in the same tab |
| 5 | Search works with the selected provider | ✅ | Google, DuckDuckGo, and *Chrome default* (via `chrome.search`). Address detection (`example.com` opens the site). Engine menu opens by keyboard. `/` focuses the search box |
| 6 | Custom wallpapers upload and display | ✅ | JPG and PNG upload. A text file renamed `.png` is rejected by a magic-byte check. The upload becomes the wallpaper and renders as a blob image. Gallery lists both. Removing the default falls back to the remaining photo |
| 7 | Unsplash valid / invalid credentials | ✅ | **Invalid key:** a real request to api.unsplash.com returns 401 and the message is shown. The current wallpaper is kept, and back-off blocks repeat requests on new tabs. **No key:** clear message. **Valid key:** mocked API. One `count=30` batch, category query sent, download ping sent, attribution links carry UTM params, image hotlinked from images.unsplash.com and sized to the screen. *Next* uses the queue without a new batch |
| 8 | 1- and 5-minute rotation | ✅ | 1 min: the alarm is scheduled at `changedAt + 60 s` and the wallpaper changed after 60.0 s with the tab open. 5 min: not due at 4 min, rotates when due, alarm rescheduled. Daily: changes after the calendar day changes. Pause clears the alarm |
| 9 | Reliable across reloads and restarts | ✅ | Due-ness comes from the persisted timestamp. Reloads trigger catch-up. The alarm exists again after a browser restart |
| 10 | Multiple tabs: no duplicate requests | ✅ | Five New Tabs opened at once with a change due: exactly **one** API batch, and all five show the same photo. Removing a shortcut in one tab updates the other open tabs |
| 11 | Settings persist after restarting Chrome | ✅ | Browser closed and relaunched on the same profile. Settings, shortcuts, favorites and wallpaper state are identical. UI reflects 24 h clock, dock on the right, bookmarks bar hidden |
| 12 | Desktop / tablet / narrow widths | ✅ | 1440×900, 820×1180, 390×844, 1024×520: no horizontal overflow, and the dock never overlaps the tiles. Settings window fits at 390 px |
| 13 | Keyboard and accessibility | ✅ | Tab order goes skip link → bookmarks → search → tiles. Every interactive element has an accessible name. Settings closes with `Esc` (native `<dialog>` focus trap). The OS reduced-motion setting turns animations off. Light wallpapers get dark text and dark ones get light text |
| 14 | Offline and network failures | ✅ | Simulated network failure on the API: "Could not reach Unsplash", wallpaper kept. Rate limit (403): message plus 15-minute back-off. Page offline when the image can't load: previous wallpaper stays and an offline notice appears |
| 15 | No console errors or unnecessary permissions | ✅ | Zero console errors or warnings from extension pages and the service worker during the whole run. Source audit: no `bookmarks.create/update/move/remove`, no `eval`, no remote scripts. The only `innerHTML` is static SVG icon markup. `fetch` is used only for Unsplash |

Also verified: shortcut add / edit / remove / reorder (menu, `Ctrl+Shift+←/→`, drag & drop) with persistence. `javascript:` URLs are rejected. Every settings section renders. Widget hide, reorder and restore. Theme, dock position, 24 h clock and gradient wallpaper apply instantly. Favorites heart. Restore defaults keeps shortcuts.

## Bugs found by testing and fixed before delivery

1. **Phone-width overlap:** at narrow widths the dock covered the corner gear button. Corner controls now sit above the dock below 900 px, and the dock scrolls horizontally if needed.
2. **Background tabs didn't repaint:** `img.decode()` can stall in hidden tabs, so background New Tabs kept the old wallpaper. Decode is now capped at 800 ms.
3. **Shortcut name autofill:** the suggested name was appended to whatever the user typed. It is now selected on focus, so typing replaces it.
4. **Fresh-profile icons:** sites missing from Chrome's favicon cache showed a generic globe. The extension now detects Chrome's default icon and shows a coloured letter tile instead.
5. **Settings spacing:** empty status lines left a gap in the Unsplash panel.

## 1.1.0 features — verified (`tests/features.js`, 62 checks)

| Feature | Result | How it was verified |
|---|---|---|
| Shortcut folders | ✅ | Create a folder from the tile menu (*Add to folder → New folder…*). Drop a tile onto a folder to add it. Drop a tile onto another tile to create a folder, with the name field focused for inline rename. Dropping on a tile's edge still reorders. The folder tile shows a preview grid and an accessible label. Inside the folder window: real links, the ⋯ menu is visible and clickable, *Move out of folder*, the **+** tile adds into the folder, `Ctrl+Shift+←` reorders. *Ungroup* works. Emptied folders disappear. Folders persist after reload and a browser restart, and show in Settings → Shortcuts |
| Open all together | ✅ | The folder window's **Open all** button and the folder ⋯ menu each opened exactly the folder's shortcuts as background tabs (tab count +2 each time), and the New Tab page stayed in front |
| To-do list | ✅ | Add with Enter, including daily tasks. The "n left" count updates. The list syncs to a second open tab. Ticking off saves. Double-click edits without toggling the task. On a simulated new day, daily tasks reset while one-off tasks keep their state. *Clear completed* removes only finished one-off tasks. Delete works. The card never covers the clock, search or tiles at 1227×700 (your window size), 1440×900, 1024×700 and 390×844. It can be hidden in Settings. It persists after a restart |
| Backup export / import | ✅ | Export downloads `sequoia-tab-backup-YYYY-MM-DD.json` containing settings, shortcuts, dock, favorites and to-dos, and **never the Unsplash key**. Import asks for confirmation with a summary, restores data, keeps the key, and updates the page at once. Unrelated JSON is rejected. A crafted file with `javascript:` and `data:` URLs, an `http:` icon, a non-Unsplash "favorite" and an oversized task was cleaned on import |
| Command palette | ✅ | `Ctrl+K` opens it focused and toggles it closed. It finds shortcuts by name and by word initials ("sd" → Support Desk), with no loose junk matches. It finds folders and offers "Open all in …", searches Chrome bookmarks, and offers "Go to" for addresses. Web search comes first when nothing matches. Enter opens a shortcut, arrow keys + Enter run actions (Add task), and settings commands open the right section. The corner ⌘ button opens it and Escape closes it |
| Layout | ✅ | On short windows the page now scrolls instead of clipping the clock off the top |

### Bugs found by testing 1.1.0 and fixed

1. **Menus inside dialogs were mis-positioned.** The dialog's open animation (`transform`, fill-mode both) made the dialog the containing block for fixed-position menus. The animation now runs on the inner sheet.
2. **Emptied folders came back after reload.** When a listener saved during another save's notification, the older write landed last. Saves now write before notifying, and the data model removes empty folders itself.
3. **Double-clicking a task toggled it instead of editing it.** The text was a `<label>`. It is now plain text, and the checkbox has its own accessible name.
4. **Folder tiles showed the browser's default button look.** Button styles are now reset.
5. **The palette's fuzzy matching was too loose** ("gm" matched "My plugin" through its URL), and multi-word queries like "settings dock" found nothing. Matching is now substring, word-initials and all-words.
6. **Centered content could be clipped** at the top of short windows. Fixed with flexible spacers.

Test-harness fixes (not extension bugs): the tests now always talk to the *current* service worker, because Chrome legitimately stops idle MV3 workers. Tabs opened by "Open all" are closed by tab id.

## 1.2.0 Google bar — verified (`tests/gbar.js`, 23 checks)

| Feature | Result | How it was verified |
|---|---|---|
| Gmail & Images links | ✅ | Exact URLs. The bar sits top-right, and the bookmarks bar shrinks so the two never overlap |
| Google apps grid | ✅ | 21 apps, all real links. It opens by keyboard with focus on the first app, arrow keys move through the 3-column grid, and Esc closes and returns focus. It fits on screen and closes on an outside click |
| Account avatar | ✅ | Menu items: Manage your Google Account, Switch account, Gmail. An uploaded photo is cropped to a 128 px WebP of about 1.4 KB and shown. Invalid files are rejected. A tampered stored value (`javascript:`) is never used as an image |
| Account number | ✅ | Choosing u/2 updates Gmail (`/mail/u/2/`) and the apps (`?authuser=2`), both from storage and from the Settings picker |
| Integration | ✅ | The palette finds Google apps ("drive" → Google Drive). The to-do card stays below the bar. On narrow windows only the apps button and avatar show, with no overflow. Hiding the bar gives the bookmarks bar its space back. **No new permissions.** No console errors |

The full core and 1.1 suites were re-run after this change: 82/82 and 62/62.

## 1.3.x Google account card — verified (`tests/gaccount.js`, 34 checks)

| Area | Result | How it was verified |
|---|---|---|
| Privacy / permissions | ✅ | `accounts.google.com` is an **optional** permission: it isn't granted at install and there's no `identity` permission. Nothing is fetched from Google before you click Connect, even when access is available. Backups never contain account info. Disconnect deletes the cached info, and nothing is fetched afterwards |
| Connected card | ✅ | Real email at the top, "Hi, Shihab!", photo at 80 px, Manage your Google Account, other signed-in accounts and Add another account. The bar avatar shows the real photo, and its accessible label has your name and email |
| Switching accounts | ✅ | Clicking another account switches Gmail and the apps (`/u/1/`) and the avatar photo |
| Efficiency | ✅ | One request on connect. Reloads and three new tabs made zero extra requests (15-minute cache) |
| Failures | ✅ | Google unreachable: the last known account stays, with a short note. Signed out of Google: says so and offers Sign in |
| Security | ✅ | A hostile name (`<img onerror=…>`) is shown as plain text and never runs. A non-Google photo URL is never loaded |
| Not connected | ✅ | The card explains the opt-in. Settings shows "Not connected"/"Connected · email" |

**Bugs found and fixed:**
- A popover opened with the mouse didn't close with Esc. Focus now moves into the popover, and Esc is handled page-wide while it's open.
- **Reported by you: "Couldn't load your Google account" in real Chrome.** Cause: Google answers `403 Forbidden` when the request carries an extension `Origin` header, which Chrome adds to every POST from an extension page. The mocked tests couldn't see this. Fix: a narrowly scoped `declarativeNetRequest` rule removes `Origin` from that one request (this URL, POST, this extension only). Verified against the **real** Google server: 403 without the rule, 200 with it. A new real-endpoint test (Part C) now guards this.
- **Reported by you again: still failing, and Try again didn't help.** Your Chrome hadn't granted the new header-rule permission because the extension hadn't been reloaded since the update, so every request still got 403. The card now detects this and shows **Open chrome://extensions**, with no doomed request sent (new Part D test). The rule now sends `Origin: https://www.google.com`, exactly like Chrome's own account request, instead of removing the header. Verified live: 200.
- **Third report: the card kept saying "reload".** Chrome records showed the extension in your bPlugins profile was last reloaded at 16:09, before the permission was added. Unpacked extensions load page code from disk live, but permissions change only on reload. The card now has a one-click **Finish update** that calls `chrome.runtime.reload()` and reopens a New Tab; the stale state is cleared, and the account loads. Tested end to end: install without the permission, update the files on disk, click Finish update → permission active, version updated, account loaded from the live Google endpoint with no error.
- The card was redesigned to match Chrome's own account card: photo with a ring, name and email, a ⌃ toggle, other accounts, Add another account, Sign out of all accounts, and a Manage your Google Account pill.
- The card briefly said "not signed in" while the first request was still running. It now shows "Loading your Google account…". On an error, it offers **Try again**.

**Limits of this test:** automation can't click Chrome's permission prompt, so the connected flow ran on a copy of the extension with the permission pre-granted. The signed-in card was tested with a mocked account list in Google's real format. The request itself was tested against the **live Google endpoint** (HTTP 200, parsed correctly; the test browser isn't signed in, so the list is empty). Please confirm the real photo and email in your own Chrome after clicking Connect.

## 1.4.0 Move & resize the to-do card — verified (`tests/todo-layout.js`, 24 checks)

Drag by the header moves the card exactly with the mouse; drag the corner resizes it (min 240×140, max 640 wide, always inside the window). Header buttons still click normally, and the list scrolls when the card is short. Arrow keys on the grip move it and on the corner resize it, with Shift for 50 px steps. The position and size are saved, persist after reload and apply to other tabs. A shrinking window pulls the card back into view; on narrow windows it sits in the page normally, and the saved spot returns when the window is wide again. Collapsing shows just the header. *Reset size & position* and double-clicking the grip both reset it. No console errors.

**Bugs found and fixed while testing:**
- A card dragged to the top went under the bookmarks bar. The page area had its own stacking layer; it was removed, and a placed card sits above the top bars.
- Every settings change re-inserted the widgets into the page, which dropped keyboard focus. Nodes now move only when their order really changes. This also helps other widgets.
- Pointer capture started on pointer-down, which swallowed double-clicks. Capture now starts only when an actual drag begins, and movement is tracked page-wide.

## 1.4.1–1.4.2 Wallpaper corner

- Self-healing Unsplash problems (rate limit, offline, server errors) no longer show on the page; Settings → Wallpaper still explains them. Problems you must fix (missing or wrong key) still show on the page.
- New **Unsplash photo credit** switch (Settings → Widgets). It is on by default; off removes the credit entirely, at your request. Settings warns that this breaks Unsplash's API rules and may get the key revoked.
- Bug found by the new test: switching the credit didn't redraw the corner until reload. Fixed.

## Not covered by automation (and why)

- **Your real Chrome profile.** Branded Chrome blocks command-line extension loading, so tests ran in a clean Chrome for Testing profile. Load the unpacked folder once in your own Chrome to confirm it there. Your real favicons will appear because you've visited those sites.
- **A real, valid Unsplash key.** No key was available, so the success path was tested with a mocked API that follows Unsplash's documented response format. The failure path (401) was tested against the real API, and real `images.unsplash.com` responses were confirmed to send `Access-Control-Allow-Origin: *`, which brightness sampling needs.
- **Alarm firing with no tab driving it.** The alarm schedule was verified (`scheduledTime = changedAt + interval`), but the 1-minute change in the test may have been triggered by the open tab's own due-timer rather than the alarm. Either path produces the same, single, serialised change.
- **Unsplash quota.** At 1-minute rotation, a demo key (50 requests/hour) will hit the limit, because each change sends a required download ping. The limit is handled gracefully and documented in the README.

## Known limitations

- Rotation runs only while Chrome is running and a New Tab is open. Otherwise it catches up on the next New Tab.
- Chrome keeps keyboard focus in the address bar for new tabs, so search autofocus isn't guaranteed. Press `/`.
- `javascript:` bookmarklets can't run from extension pages.
- Widgets can be shown, hidden, reordered, and placed centered or at the top. Free-form dragging of widgets is not implemented.
- No weather widget. The spec allows it only if it is reliable, and it would need a third-party API and location access.
- Real Google photo, name and email need the optional *Connect Google account* step. The account list endpoint is undocumented. If Google changes it, the card falls back to the last cached info or your uploaded photo; nothing breaks.
- Folders are one level deep (no folders inside folders), like Launchpad.
- A backup doesn’t include uploaded photos (they can be large). Re-upload them after moving to another computer.
- Chrome's install prompt says "Read and change your bookmarks" because no read-only bookmarks permission exists. The code only reads.
