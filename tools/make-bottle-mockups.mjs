// Water-bottle mockups: puts each real sticker (public/stickers/all/<name>-1400.webp) on a clean
// bottle photo with StickerBottle (tools/bottle/sticker-bottle.js, the same code medicalstickers.shop
// uses), crops a square around the bottle and writes public/stickers/bottle/<name>.webp (800×800).
// Wide state-name art is turned to run down the bottle, top to bottom, like a real 6″ sticker would.
//
// Needs Playwright with Chromium (not a site dependency):
//   npm i --no-save playwright && npx playwright install chromium
//   node tools/make-bottle-mockups.mjs [name ...]     e.g. california-stained-glass
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(root, 'public/stickers/all');
const OUT = path.join(root, 'public/stickers/bottle');

// Geometry of tools/bottle/base.jpg (handled olive bottle, 1519×1036). Same numbers as
// the defaults in tools/bottle/sticker-bottle.js. Re-measure if the photo changes:
// cx/cy = where the sticker's centre sits on the front face, radius = half the body width there, tilt = lean.
const BOTTLE = { imageW: 1519, imageH: 1036, cx: 700, cy: 560, radius: 150, tilt: 0, curve: 8 };
// Sticker size on the bottle: tall art (rotated wordmarks) vs square/round art.
// The body is narrower than the old photo, so these stay on the front face, off the lid, base, and handle.
const TALL = { area: 100000, maxW: 240, maxH: 520 };
const SQUARE = { area: 54000, maxW: 250, maxH: 280 };
// Square crop around the bottle, including the handle: [x, y, size] in image pixels.
const CROP = [342, 0, 1036];

const only = process.argv.slice(2);
const names = fs.readdirSync(ART)
  .filter((f) => f.endsWith('-1400.webp'))
  .map((f) => f.slice(0, -'-1400.webp'.length))
  .filter((n) => !only.length || only.includes(n));
if (!names.length) throw new Error('make-bottle-mockups: no matching art in public/stickers/all');
fs.mkdirSync(OUT, { recursive: true });

// Serve the repo so the page can load the script, the photo and the art.
const types = { '.js': 'text/javascript', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' })).newPage();
await page.setContent(`<!doctype html><body style="margin:0"><div id="b" style="width:${BOTTLE.imageW}px"></div>`);
await page.addScriptTag({ url: `${base}/tools/bottle/sticker-bottle.js` });

for (const name of names) {
  const dataUrl = await page.evaluate(async ({ src, photo, bottle, tall, square, crop }) => {
    const im = new Image(); im.crossOrigin = 'anonymous'; im.src = src; await im.decode();
    // Trim the transparent margin so every design sits at the same size.
    const t = document.createElement('canvas'); t.width = im.width; t.height = im.height;
    const tg = t.getContext('2d'); tg.drawImage(im, 0, 0);
    const a = tg.getImageData(0, 0, t.width, t.height).data;
    let x0 = t.width, y0 = t.height, x1 = 0, y1 = 0;
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
      if (a[(y * t.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, wide = w / h > 1.6;
    // Wide wordmarks turn 90° clockwise so they read top to bottom down the bottle.
    const s = document.createElement('canvas'); s.width = wide ? h : w; s.height = wide ? w : h;
    const sg = s.getContext('2d');
    if (wide) { sg.translate(h, 0); sg.rotate(Math.PI / 2); }
    sg.drawImage(t, x0, y0, w, h, 0, 0, w, h);

    const el = document.getElementById('b'); el.innerHTML = '';
    const run = StickerBottle.mount(el, { ...bottle, ...(wide ? tall : square), base: photo, startAt: 1200, stickers: [s.toDataURL()], label: '' });
    await new Promise((r) => setTimeout(r, 1600));
    run.stop();
    const out = document.createElement('canvas'); out.width = out.height = 800;
    out.getContext('2d').drawImage(run.canvas, crop[0], crop[1], crop[2], crop[2], 0, 0, 800, 800);
    return out.toDataURL('image/webp', 0.8);
  }, { src: `${base}/public/stickers/all/${name}-1400.webp`, photo: `${base}/tools/bottle/base.jpg`, bottle: BOTTLE, tall: TALL, square: SQUARE, crop: CROP });
  fs.writeFileSync(path.join(OUT, `${name}.webp`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(name);
}

await browser.close();
server.close();
