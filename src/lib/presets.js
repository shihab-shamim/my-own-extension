// Built-in wallpapers rendered purely with CSS gradients, so they work offline
// and cost nothing to load. `tone` is the perceived brightness of the area
// behind the clock ("dark" => use light text).

export const PRESETS = [
  {
    id: 'sequoia',
    name: 'Sequoia',
    tone: 'dark',
    color: '#3a2b5c',
    css: [
      'radial-gradient(ellipse 80% 60% at 15% 85%, rgba(255,120,90,.85) 0%, rgba(255,120,90,0) 60%)',
      'radial-gradient(ellipse 70% 60% at 85% 80%, rgba(240,70,140,.75) 0%, rgba(240,70,140,0) 60%)',
      'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(40,60,170,.9) 0%, rgba(40,60,170,0) 70%)',
      'linear-gradient(180deg, #141a4a 0%, #4b2c7a 55%, #c2577a 100%)',
    ].join(','),
  },
  {
    id: 'sonoma',
    name: 'Sonoma',
    tone: 'dark',
    color: '#2f6a5a',
    css: [
      'radial-gradient(ellipse 70% 55% at 20% 75%, rgba(120,200,120,.8) 0%, rgba(120,200,120,0) 60%)',
      'radial-gradient(ellipse 60% 50% at 80% 70%, rgba(250,190,90,.7) 0%, rgba(250,190,90,0) 60%)',
      'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(20,90,120,.95) 0%, rgba(20,90,120,0) 70%)',
      'linear-gradient(180deg, #0f3b4a 0%, #2c6a5c 50%, #b88a4a 100%)',
    ].join(','),
  },
  {
    id: 'ventura',
    name: 'Ventura',
    tone: 'dark',
    color: '#c2552d',
    css: [
      'radial-gradient(ellipse 80% 60% at 70% 30%, rgba(255,170,60,.9) 0%, rgba(255,170,60,0) 60%)',
      'radial-gradient(ellipse 70% 70% at 20% 80%, rgba(200,40,60,.85) 0%, rgba(200,40,60,0) 65%)',
      'linear-gradient(160deg, #3a0d1c 0%, #a3322a 50%, #f08a3c 100%)',
    ].join(','),
  },
  {
    id: 'monterey',
    name: 'Monterey',
    tone: 'dark',
    color: '#3d2f8f',
    css: [
      'radial-gradient(ellipse 60% 50% at 25% 30%, rgba(90,150,255,.85) 0%, rgba(90,150,255,0) 60%)',
      'radial-gradient(ellipse 70% 60% at 75% 70%, rgba(190,80,230,.8) 0%, rgba(190,80,230,0) 60%)',
      'radial-gradient(ellipse 50% 40% at 60% 20%, rgba(255,110,170,.6) 0%, rgba(255,110,170,0) 60%)',
      'linear-gradient(135deg, #10123a 0%, #2b2a8a 50%, #6a2a8f 100%)',
    ].join(','),
  },
  {
    id: 'bigsur',
    name: 'Big Sur Dusk',
    tone: 'dark',
    color: '#24456e',
    css: [
      'radial-gradient(ellipse 100% 45% at 50% 100%, rgba(255,140,100,.75) 0%, rgba(255,140,100,0) 70%)',
      'radial-gradient(ellipse 60% 50% at 80% 40%, rgba(80,170,230,.55) 0%, rgba(80,170,230,0) 65%)',
      'linear-gradient(180deg, #071a33 0%, #1d3f6e 55%, #6c6e9a 85%, #e3907a 100%)',
    ].join(','),
  },
  {
    id: 'daylight',
    name: 'Daylight',
    tone: 'light',
    color: '#cfe3f6',
    css: [
      'radial-gradient(ellipse 70% 60% at 20% 20%, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 60%)',
      'radial-gradient(ellipse 70% 60% at 85% 75%, rgba(160,200,255,.9) 0%, rgba(160,200,255,0) 60%)',
      'radial-gradient(ellipse 60% 50% at 30% 90%, rgba(255,205,225,.9) 0%, rgba(255,205,225,0) 60%)',
      'linear-gradient(160deg, #eef4fb 0%, #cfe0f5 50%, #e7d6f2 100%)',
    ].join(','),
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tone: 'dark',
    color: '#0e3a40',
    css: [
      'radial-gradient(ellipse 60% 40% at 30% 40%, rgba(60,230,170,.55) 0%, rgba(60,230,170,0) 65%)',
      'radial-gradient(ellipse 50% 45% at 70% 30%, rgba(90,140,255,.5) 0%, rgba(90,140,255,0) 65%)',
      'radial-gradient(ellipse 40% 30% at 60% 55%, rgba(180,90,255,.4) 0%, rgba(180,90,255,0) 65%)',
      'linear-gradient(180deg, #02070f 0%, #06202a 60%, #0b2c33 100%)',
    ].join(','),
  },
  {
    id: 'graphite',
    name: 'Graphite',
    tone: 'dark',
    color: '#2a2c31',
    css: [
      'radial-gradient(ellipse 80% 60% at 30% 20%, rgba(110,116,128,.55) 0%, rgba(110,116,128,0) 65%)',
      'radial-gradient(ellipse 70% 60% at 80% 90%, rgba(70,74,84,.7) 0%, rgba(70,74,84,0) 65%)',
      'linear-gradient(160deg, #1b1c20 0%, #2c2e34 55%, #18191c 100%)',
    ].join(','),
  },
];

export const GRADIENT_SWATCHES = [
  { from: '#4f6df5', to: '#c06bd8', angle: 135 },
  { from: '#ff7e5f', to: '#feb47b', angle: 135 },
  { from: '#43cea2', to: '#185a9d', angle: 135 },
  { from: '#141e30', to: '#243b55', angle: 160 },
  { from: '#ee9ca7', to: '#ffdde1', angle: 135 },
  { from: '#0f2027', to: '#2c5364', angle: 135 },
  { from: '#f7971e', to: '#ffd200', angle: 120 },
  { from: '#8e2de2', to: '#4a00e0', angle: 135 },
];

export const COLOR_SWATCHES = [
  '#1f2933', '#0b1020', '#2d3a4a', '#3b2f4a', '#16423c', '#5a2a27',
  '#e9e4dc', '#dbe7f3', '#f3e1e6', '#c9d6c4',
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

export function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function hexToRgb(hex) {
  const h = isHexColor(hex) ? hex.slice(1) : '000000';
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// WCAG relative luminance in 0..1
export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// White text has better contrast than near-black text when luminance < ~0.18.
export function toneForRgb(rgb) {
  return luminance(rgb) > 0.36 ? 'light' : 'dark';
}

export function toneForHex(hex) {
  return toneForRgb(hexToRgb(hex));
}

export function mixHex(a, b) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return '#' + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, '0')).join('');
}

export function gradientCss(g) {
  const from = isHexColor(g?.from) ? g.from : '#4f6df5';
  const to = isHexColor(g?.to) ? g.to : '#c06bd8';
  const angle = Number.isFinite(+g?.angle) ? Math.max(0, Math.min(360, +g.angle)) : 135;
  return `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`;
}
