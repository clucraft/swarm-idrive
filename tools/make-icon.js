'use strict';
/**
 * Draws the app's tile icon from the game's own sprites: apps/<id>/icon.png, 140 x 140 on a
 * see-through background (what the kit's build and the MGU Store take). Run after changing the
 * sprites:
 *
 *   node tools/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const APPS = path.join(ROOT, 'apps');
const APP = path.join(APPS, fs.readdirSync(APPS).filter((d) => fs.existsSync(path.join(APPS, d, 'app.json')))[0]);
const SP = require(path.join(APP, 'sprites'));

const SIZE = 140;
const px = Buffer.alloc(SIZE * SIZE * 4);          // RGBA, all see-through

/** sprite spr, k times as big, its top left corner at x, y */
function put(spr, x, y, k) {
    for (let sy = 0; sy < spr.h; sy++) for (let sx = 0; sx < spr.w; sx++) {
        const i = spr.idx[sy * spr.w + sx];
        if (!i) continue;
        const c = spr.pal[i - 1];
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
            const X = x + sx * k + dx, Y = y + sy * k + dy;
            if (X < 0 || Y < 0 || X >= SIZE || Y >= SIZE) continue;
            const o = (Y * SIZE + X) * 4;
            px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
        }
    }
}

// two of the swarm over the player's ship, a shot on its way
put(SP.DART[0], 6, 2, 4);
put(SP.CLAW[0], 70, 2, 4);
put(SP.BOLT, 64, 58, 4);
put(SP.SHIP, 38, 74, 4);

/* ---------- a PNG file ---------- */
const table = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
    const len = Buffer.alloc(4), sum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]);
    len.writeUInt32BE(data.length, 0); sum.writeUInt32BE(crc(body), 0);
    return Buffer.concat([len, body, sum]);
};
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
const head = Buffer.alloc(13);
head.writeUInt32BE(SIZE, 0); head.writeUInt32BE(SIZE, 4); head[8] = 8; head[9] = 6;
const out = path.join(APP, 'icon.png');
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('make-icon: ' + path.relative(ROOT, out) + ' (' + fs.statSync(out).size + ' bytes)');
