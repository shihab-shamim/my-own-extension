# Testing report — Sequoia Tab 1.0.0

**Date:** 2026-10-13
**Environment:** Windows 11 Pro, Chrome for Testing 148.0.7778.97 driven by Puppeteer 24. Branded Chrome 155 is installed, but it no longer accepts `--load-extension`, so automated runs use Chrome for Testing.
**Suite:** `tests/e2e.js`, the real extension loaded unpacked
**Result:** **82 / 82 checks passed** in the final full run on the shipped code. The run includes a real 65-second wait for the 1-minute rotation and a full browser restart.

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
- Chrome's install prompt says "Read and change your bookmarks" because no read-only bookmarks permission exists. The code only reads.
