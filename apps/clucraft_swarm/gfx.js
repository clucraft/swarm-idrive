'use strict';
/**
 * gfx.js - a small software framebuffer: the game draws every picture pixel by pixel into a
 * Surface (RGBA bytes), and main.js hands the bytes to the kit's renderer as one image, shown
 * at a whole multiple of its size. That is what gives the picture its chunky 8-bit look.
 *
 * Nothing here knows about the head unit: the tests run it under plain Node.
 */

/* ---------- the font: 7 x 7 pixels in an 8 x 8 cell, upper case ---------- */
const GLYPHS = {
    'A': ['..###..', '.##.##.', '##...##', '##...##', '#######', '##...##', '##...##'],
    'B': ['######.', '##...##', '##...##', '######.', '##...##', '##...##', '######.'],
    'C': ['.#####.', '##...##', '##.....', '##.....', '##.....', '##...##', '.#####.'],
    'D': ['#####..', '##..##.', '##...##', '##...##', '##...##', '##..##.', '#####..'],
    'E': ['#######', '##.....', '##.....', '#####..', '##.....', '##.....', '#######'],
    'F': ['#######', '##.....', '##.....', '#####..', '##.....', '##.....', '##.....'],
    'G': ['.#####.', '##...##', '##.....', '##.####', '##...##', '##...##', '.######'],
    'H': ['##...##', '##...##', '##...##', '#######', '##...##', '##...##', '##...##'],
    'I': ['.######', '...##..', '...##..', '...##..', '...##..', '...##..', '.######'],
    'J': ['...####', '....##.', '....##.', '....##.', '....##.', '##..##.', '.####..'],
    'K': ['##...##', '##..##.', '##.##..', '####...', '##.##..', '##..##.', '##...##'],
    'L': ['##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######'],
    'M': ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##', '##...##'],
    'N': ['##...##', '###..##', '####.##', '##.####', '##..###', '##...##', '##...##'],
    'O': ['.#####.', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.'],
    'P': ['######.', '##...##', '##...##', '######.', '##.....', '##.....', '##.....'],
    'Q': ['.#####.', '##...##', '##...##', '##...##', '##.#.##', '##..##.', '.###.##'],
    'R': ['######.', '##...##', '##...##', '######.', '##.##..', '##..##.', '##...##'],
    'S': ['.#####.', '##...##', '##.....', '.#####.', '.....##', '##...##', '.#####.'],
    'T': ['.######', '...##..', '...##..', '...##..', '...##..', '...##..', '...##..'],
    'U': ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.'],
    'V': ['##...##', '##...##', '##...##', '##...##', '.##.##.', '..###..', '...#...'],
    'W': ['##...##', '##...##', '##...##', '##.#.##', '#######', '###.###', '##...##'],
    'X': ['##...##', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '##...##'],
    'Y': ['.##..##', '.##..##', '..####.', '...##..', '...##..', '...##..', '...##..'],
    'Z': ['#######', '....##.', '...##..', '..##...', '.##....', '##.....', '#######'],
    '0': ['.#####.', '##...##', '##..###', '##.#.##', '###..##', '##...##', '.#####.'],
    '1': ['...##..', '..###..', '...##..', '...##..', '...##..', '...##..', '.######'],
    '2': ['.#####.', '##...##', '.....##', '..####.', '.##....', '##.....', '#######'],
    '3': ['.#####.', '##...##', '.....##', '..####.', '.....##', '##...##', '.#####.'],
    '4': ['...###.', '..####.', '.##.##.', '##..##.', '#######', '....##.', '....##.'],
    '5': ['#######', '##.....', '######.', '.....##', '.....##', '##...##', '.#####.'],
    '6': ['.#####.', '##.....', '##.....', '######.', '##...##', '##...##', '.#####.'],
    '7': ['#######', '.....##', '....##.', '...##..', '..##...', '..##...', '..##...'],
    '8': ['.#####.', '##...##', '##...##', '.#####.', '##...##', '##...##', '.#####.'],
    '9': ['.#####.', '##...##', '##...##', '.######', '.....##', '.....##', '.#####.'],
    ' ': ['.......', '.......', '.......', '.......', '.......', '.......', '.......'],
    '-': ['.......', '.......', '.......', '.#####.', '.......', '.......', '.......'],
    '.': ['.......', '.......', '.......', '.......', '.......', '..##...', '..##...'],
    ',': ['.......', '.......', '.......', '.......', '..##...', '..##...', '.##....'],
    '!': ['..##...', '..##...', '..##...', '..##...', '..##...', '.......', '..##...'],
    '?': ['.#####.', '##...##', '.....##', '...###.', '...##..', '.......', '...##..'],
    ':': ['.......', '..##...', '..##...', '.......', '..##...', '..##...', '.......'],
    '%': ['##...#.', '##..##.', '...##..', '..##...', '.##....', '##..##.', '#...##.'],
    '/': ['.....##', '....##.', '...##..', '..##...', '.##....', '##.....', '#......'],
    '\'': ['..##...', '..##...', '.##....', '.......', '.......', '.......', '.......'],
    '+': ['.......', '..##...', '..##...', '######.', '..##...', '..##...', '.......'],
    '=': ['.......', '.......', '.#####.', '.......', '.#####.', '.......', '.......'],
    '<': ['....##.', '...##..', '..##...', '.##....', '..##...', '...##..', '....##.'],
    '>': ['.##....', '..##...', '...##..', '....##.', '...##..', '..##...', '.##....'],
    '(': ['...##..', '..##...', '.##....', '.##....', '.##....', '..##...', '...##..'],
    ')': ['..##...', '...##..', '....##.', '....##.', '....##.', '...##..', '..##...'],
    '*': ['.......', '.#.#.#.', '..###..', '.#####.', '..###..', '.#.#.#.', '.......'],
    // (lower case x: a small "times" sign, e.g. x2)
    'x': ['.......', '.......', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.'],
    // (degree sign)
    '^': ['.###...', '##.##..', '.###...', '.......', '.......', '.......', '.......'],
};
const CELL = 8, GW = 7, GH = 7;
// each glyph as 7 row bitmasks (bit 6 = leftmost pixel)
const FONT = {};
Object.keys(GLYPHS).forEach((ch) => {
    const rows = GLYPHS[ch];
    if (rows.length !== GH) throw new Error('glyph ' + ch + ': ' + rows.length + ' rows');
    FONT[ch] = rows.map((r) => {
        if (r.length !== GW) throw new Error('glyph ' + ch + ': row "' + r + '"');
        let m = 0;
        for (let i = 0; i < GW; i++) if (r.charAt(i) === '#') m |= 1 << (GW - 1 - i);
        return m;
    });
});
/** the glyph a character is drawn with (lower case letters as upper case), or null */
function glyphOf(ch) {
    if (FONT[ch]) return FONT[ch];
    const up = ch.toUpperCase();
    return FONT[up] || null;
}

/* ---------- sprites ---------- */
/**
 * A sprite from rows of palette letters ('.' = see-through):
 *   { w, h, idx: Uint8Array (0 = see-through, else 1 + its colour's place in pal), pal: [[r, g, b], ...] }
 */
function sprite(rows, colours) {
    const h = rows.length, w = rows[0].length;
    const letters = [], pal = [], idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        if (rows[y].length !== w) throw new Error('sprite row ' + y + ' is ' + rows[y].length + ' wide, not ' + w + ': "' + rows[y] + '"');
        for (let x = 0; x < w; x++) {
            const ch = rows[y].charAt(x);
            if (ch === '.') continue;
            let i = letters.indexOf(ch);
            if (i < 0) {
                if (!colours[ch]) throw new Error('sprite colour "' + ch + '" is not in the palette');
                i = letters.length; letters.push(ch); pal.push(colours[ch]);
            }
            idx[y * w + x] = i + 1;
        }
    }
    return { w, h, idx, pal, letters };
}

/** The same sprite in other colours: swap = { letter: [r, g, b] }. */
function recolour(spr, swap) {
    return { w: spr.w, h: spr.h, idx: spr.idx, letters: spr.letters, pal: spr.pal.map((c, i) => swap[spr.letters[i]] || c) };
}

/** The sprite turned clockwise by a (radians) about its centre, nearest pixel. */
function rotate(spr, a) {
    const w = spr.w, h = spr.h, out = new Uint8Array(w * h);
    const cx = (w - 1) / 2, cy = (h - 1) / 2, c = Math.cos(a), s = Math.sin(a);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            // where this pixel comes from: turned back by a
            const dx = x - cx, dy = y - cy;
            const sx = Math.round(cx + dx * c + dy * s), sy = Math.round(cy - dx * s + dy * c);
            if (sx >= 0 && sx < w && sy >= 0 && sy < h) out[y * w + x] = spr.idx[sy * w + sx];
        }
    }
    return { w, h, idx: out, pal: spr.pal, letters: spr.letters };
}

/* ---------- the framebuffer ---------- */
class Surface {
    constructor(w, h) {
        this.w = w | 0; this.h = h | 0;
        this.data = new Uint8Array(this.w * this.h * 4);
        this.clear([0, 0, 0]);
    }
    clear(c) {
        const d = this.data, r = c[0], g = c[1], b = c[2];
        if (r === 0 && g === 0 && b === 0) {
            d.fill(0);
            for (let i = 3; i < d.length; i += 4) d[i] = 255;
            return this;
        }
        for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
        return this;
    }
    pset(x, y, c) {
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = (y * this.w + x) * 4, d = this.data;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    rect(x, y, w, h, c) {
        x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
        let x0 = Math.max(0, x), y0 = Math.max(0, y);
        const x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
        const d = this.data, r = c[0], g = c[1], b = c[2];
        for (; y0 < y1; y0++) {
            let i = (y0 * this.w + x0) * 4;
            for (let xx = x0; xx < x1; xx++, i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
        }
        return this;
    }
    /** a 1 px frame */
    frame(x, y, w, h, c) {
        this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c);
        this.rect(x, y, 1, h, c); this.rect(x + w - 1, y, 1, h, c);
        return this;
    }
    /** Draw a sprite with its top left corner at x, y (pal: other colours for it). */
    blit(spr, x, y, pal) {
        x = Math.round(x); y = Math.round(y);
        const p = pal || spr.pal, d = this.data, W = this.w, H = this.h, sw = spr.w, sh = spr.h, src = spr.idx;
        for (let sy = 0; sy < sh; sy++) {
            const yy = y + sy;
            if (yy < 0 || yy >= H) continue;
            for (let sx = 0; sx < sw; sx++) {
                const k = src[sy * sw + sx];
                if (!k) continue;
                const xx = x + sx;
                if (xx < 0 || xx >= W) continue;
                const c = p[k - 1], i = (yy * W + xx) * 4;
                d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
            }
        }
        return this;
    }
    /** Draw a sprite centred on x, y. */
    blitC(spr, x, y, pal) { return this.blit(spr, x - spr.w / 2, y - spr.h / 2, pal); }
    /**
     * Text from x, y (the cell's top left corner) in colour c, scale times as big.
     * c may be a function (row 0..6 of the glyph) -> colour, for striped lettering.
     */
    text(str, x, y, c, scale) {
        const s = scale || 1;
        str = String(str);
        x = Math.round(x); y = Math.round(y);
        for (let n = 0; n < str.length; n++) {
            const g = glyphOf(str.charAt(n));
            if (g) {
                for (let r = 0; r < GH; r++) {
                    const m = g[r];
                    if (!m) continue;
                    const col = typeof c === 'function' ? c(r) : c;
                    for (let b = 0; b < GW; b++) {
                        if (m & (1 << (GW - 1 - b))) {
                            if (s === 1) this.pset(x + b, y + r, col);
                            else this.rect(x + b * s, y + r * s, s, s, col);
                        }
                    }
                }
            }
            x += CELL * s;
        }
        return this;
    }
    /** Text centred on cx. */
    textC(str, cx, y, c, scale) { return this.text(str, cx - textWidth(str, scale) / 2, y, c, scale); }
    /** Text ending at x (right-aligned). */
    textR(str, x, y, c, scale) { return this.text(str, x - textWidth(str, scale), y, c, scale); }
}

/** width in pixels of a text (the last cell's empty column not counted) */
function textWidth(str, scale) {
    const n = String(str).length;
    return n ? (n * CELL - 1) * (scale || 1) : 0;
}

module.exports = { Surface, sprite, recolour, rotate, textWidth, glyphOf, CELL, FONT };
