// Runs synchronously before first paint: re-applies the last wallpaper and
// appearance from a small localStorage snapshot so a new tab never flashes.
(function () {
  try {
    var raw = localStorage.getItem('sequoia:boot');
    if (!raw) return;
    var s = JSON.parse(raw);
    var root = document.documentElement;
    if (typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) root.style.setProperty('--boot-color', s.color);
    if (typeof s.bg === 'string' && s.bg.length < 8000) root.style.setProperty('--boot-bg', s.bg);
    if (s.tone === 'light' || s.tone === 'dark') root.dataset.tone = s.tone;
    if (s.theme === 'light' || s.theme === 'dark') root.dataset.theme = s.theme;
    if (s.vars && typeof s.vars === 'object') {
      for (var k in s.vars) {
        if (/^--[a-z-]+$/.test(k) && typeof s.vars[k] === 'string') root.style.setProperty(k, s.vars[k]);
      }
    }
  } catch (e) {
    /* storage unavailable: render with defaults */
  }
})();
