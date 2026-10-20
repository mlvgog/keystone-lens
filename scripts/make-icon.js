'use strict';

// Renders the app icon (an original emblem: gold ring + glowing talent nodes) to
// src/assets/icon.png. Run with: npm run icon
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const OUT = path.join(__dirname, '..', 'src', 'assets', 'icon.png');

function octagon(cx, cy, r) {
  return Array.from({ length: 8 }, (_, k) => {
    const a = ((22.5 + k * 45) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="65%">
      <stop offset="0" stop-color="#30406a"/>
      <stop offset="0.55" stop-color="#141a2c"/>
      <stop offset="1" stop-color="#06070c"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3b0"/>
      <stop offset="0.3" stop-color="#e8b84a"/>
      <stop offset="0.65" stop-color="#a1721a"/>
      <stop offset="1" stop-color="#4f3406"/>
    </linearGradient>
    <radialGradient id="node" cx="45%" cy="35%" r="70%">
      <stop offset="0" stop-color="#fffbe0"/>
      <stop offset="0.45" stop-color="#ffd100"/>
      <stop offset="1" stop-color="#9c6200"/>
    </radialGradient>
    <radialGradient id="cyan" cx="45%" cy="35%" r="70%">
      <stop offset="0" stop-color="#e6fbff"/>
      <stop offset="0.5" stop-color="#5fe0ff"/>
      <stop offset="1" stop-color="#156a85"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <circle cx="256" cy="256" r="246" fill="url(#gold)"/>
  <circle cx="256" cy="256" r="226" fill="#140d04"/>
  <circle cx="256" cy="256" r="216" fill="url(#bg)"/>
  <g stroke="#ffd100" stroke-width="15" stroke-linecap="round" filter="url(#glow)">
    <line x1="256" y1="128" x2="160" y2="252"/>
    <line x1="256" y1="128" x2="352" y2="252"/>
    <line x1="160" y1="252" x2="256" y2="380"/>
    <line x1="352" y1="252" x2="256" y2="380"/>
  </g>
  <g filter="url(#glow)" stroke="#3d2603" stroke-width="7">
    <circle cx="256" cy="128" r="46" fill="url(#node)"/>
    <rect x="116" y="208" width="88" height="88" rx="16" fill="url(#node)"/>
    <polygon points="${octagon(352, 252, 50)}" fill="url(#cyan)"/>
    <circle cx="256" cy="380" r="46" fill="url(#node)"/>
  </g>
  <text x="256" y="143" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="44" fill="#5a3a02">M+</text>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`)}`
  );
  await new Promise((r) => setTimeout(r, 500));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, image.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG());
  console.log(`Wrote ${OUT} (${SIZE}x${SIZE})`);
  app.quit();
});
