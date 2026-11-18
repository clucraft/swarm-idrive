'use strict';
/**
 * sprites.js - the game's pixel art. Every picture here is original to this game: drawn as rows of
 * palette letters, 16 x 16 pixels for ships, turned in 22.5 degree steps for flying.
 *
 * The player's ship is drawn nose up. The swarm's craft are drawn as they sit in the formation,
 * nose down (towards the player); TURNS[k] is that picture turned clockwise by k x 22.5 degrees.
 */
const { sprite, recolour, rotate } = require('./gfx');

const C = {
    W: [252, 252, 252],     // white
    S: [164, 172, 188],     // silver
    K: [12, 12, 20],        // near black
    R: [236, 44, 52],       // red
    O: [252, 148, 36],      // orange
    Y: [252, 228, 72],      // yellow
    G: [60, 212, 84],       // green
    L: [168, 244, 96],      // lime
    C: [72, 220, 236],      // cyan
    T: [20, 164, 172],      // teal
    B: [56, 104, 240],      // blue
    D: [28, 44, 140],       // dark blue
    P: [156, 84, 240],      // purple
    V: [96, 44, 172],       // violet
    M: [244, 84, 188],      // magenta
};

/* ---------- the player's ship: a delta wing, nose up ---------- */
const SHIP = sprite([
    '.......WW.......',
    '.......WW.......',
    '......WWWW......',
    '......WCCW......',
    '......WCCW......',
    '.....TWWWWT.....',
    '.....TWWWWT.....',
    '....TTWWWWTT....',
    '...TTTWOOWTTT...',
    '..TTTSWOOWSTTT..',
    '.TTTSSWWWWSSTTT.',
    'TTTSSWWWWWWSSTTT',
    'TTSS.WWSSWW.SSTT',
    'TS...OO..OO...ST',
    'T....OO..OO....T',
    '.....YY..YY.....',
], C);
// a ship the swarm holds: the same ship in its captor's colours
const SHIP_HELD = recolour(SHIP, { T: C.R, S: [128, 60, 72], C: C.Y, O: C.M, Y: C.M });

/* ---------- the swarm, nose down, two wing beats each ---------- */
// Dart: the rank and file, a green arrowhead
const DART = [
    sprite([
        '................',
        'GG............GG',
        'GGG..........GGG',
        'LGGG........GGGL',
        '.LGGG.YYYY.GGGL.',
        '..LGGGYYYYGGGL..',
        '...LGGYMMYGGL...',
        '...LGGYMMYGGL...',
        '....GGYYYYGG....',
        '....LGGYYGGL....',
        '.....GGYYGG.....',
        '.....LGYYGL.....',
        '......GYYG......',
        '......LGGL......',
        '.......GG.......',
        '................',
    ], C),
    sprite([
        '................',
        '.GG..........GG.',
        '.GGG........GGG.',
        '.LGGG......GGGL.',
        '.LGGG.YYYY.GGGL.',
        '..LGGGYYYYGGGL..',
        '...LGGYMMYGGL...',
        '...LGGYMMYGGL...',
        '....GGYYYYGG....',
        '....LGGYYGGL....',
        '.....GGYYGG.....',
        '.....LGYYGL.....',
        '......GYYG......',
        '......LGGL......',
        '.......GG.......',
        '................',
    ], C),
];
// Claw: the middle ranks, a purple hull with two grabbing arms
const CLAW = [
    sprite([
        '................',
        '....PPPPPPPP....',
        '..PPPPPPPPPPPP..',
        '.PPPVPPPPPPVPPP.',
        '.PPCCCPPPPCCCPP.',
        'PPPCWKPPPPKWCPPP',
        'PPPCCCPPPPCCCPPP',
        'PPPPPPPMMPPPPPPP',
        'PPPPVPPMMPPVPPPP',
        'PPPP.VPPPPV.PPPP',
        'PPP...VPPV...PPP',
        'PPP....VV....PPP',
        '.PP..........PP.',
        '.PPV........VPP.',
        '..VV........VV..',
        '................',
    ], C),
    sprite([
        '................',
        '....PPPPPPPP....',
        '..PPPPPPPPPPPP..',
        '.PPPVPPPPPPVPPP.',
        '.PPCCCPPPPCCCPP.',
        'PPPCWKPPPPKWCPPP',
        'PPPCCCPPPPCCCPPP',
        'PPPPPPPMMPPPPPPP',
        'PPPPVPPMMPPVPPPP',
        'PPPP.VPPPPV.PPPP',
        '.PPP..VPPV..PPP.',
        '..PPP..VV..PPP..',
        '...PP......PP...',
        '...PPV....VPP...',
        '....VV....VV....',
        '................',
    ], C),
];
// Warden: the top rank, a domed saucer that takes two hits and carries the capture beam
const WARDEN = [
    sprite([
        '................',
        '......CCCC......',
        '....CCWWCCCC....',
        '...CCWWCCCCCC...',
        '...CCCCCCCCCC...',
        '..OOOOOOOOOOOO..',
        '.OOYYOOOOOOYYOO.',
        'OOOYYOORROOYYOOO',
        'OOOOOOORROOOOOOO',
        'YOYOYOYOOYOYOYOY',
        '.OOOOOOOOOOOOOO.',
        '..RROOORROOORR..',
        '...R..ORRO..R...',
        '......ORRO......',
        '.......RR.......',
        '................',
    ], C),
    sprite([
        '................',
        '......CCCC......',
        '....CCWWCCCC....',
        '...CCWWCCCCCC...',
        '...CCCCCCCCCC...',
        '..OOOOOOOOOOOO..',
        '.OOYYOOOOOOYYOO.',
        'OOOYYOORROOYYOOO',
        'OOOOOOORROOOOOOO',
        'OYOYOYOYYOYOYOYO',
        '.OOOOOOOOOOOOOO.',
        '.RR.OOORROOO.RR.',
        '..R...ORRO...R..',
        '......ORRO......',
        '.......RR.......',
        '................',
    ], C),
];
// a Warden that has taken its first hit
const HURT = { O: [96, 108, 236], Y: [200, 212, 252], R: C.M, C: [150, 154, 176], W: C.S };
const WARDEN_HURT = WARDEN.map((s) => recolour(s, HURT));

/* ---------- shots ---------- */
const BOLT = sprite([
    '.W.',
    '.W.',
    'CWC',
    'CWC',
    'CWC',
    'CWC',
    '.C.',
    '.C.',
], C);
const BOMB = sprite([
    '.Y.',
    'YMY',
    'YMY',
    'MMM',
    '.M.',
    '.M.',
], C);

/* ---------- stage markers: 1, 5 and 10 stages ---------- */
const MARK1 = sprite([
    '........',
    '........',
    '........',
    '........',
    '...YY...',
    '..YYYY..',
    '.YY..YY.',
    'YY....YY',
    'Y......Y',
    '........',
    '........',
    '........',
], C);
const MARK5 = sprite([
    '........',
    '...OO...',
    '..OOOO..',
    '.OO..OO.',
    'OO....OO',
    'O..OO..O',
    '..OOOO..',
    '.OO..OO.',
    'OO....OO',
    'O......O',
    '........',
    '........',
], C);
const MARK10 = sprite([
    'RRRRRRRR',
    'RWWWWWWR',
    'RW.RR.WR',
    'RWRRRRWR',
    'RWRRRRWR',
    'RW.RR.WR',
    'RWWWWWWR',
    '.RWWWWR.',
    '.RRWWRR.',
    '..RRRR..',
    '...RR...',
    '........',
], C);

/* ---------- explosions: drawn by rule, not by hand ---------- */
/**
 * One frame of a burst: rays of sparks flying out from the centre. size: the picture's side,
 * t: 0 (just hit) .. 1 (gone), colours: letters from the hot core outwards, salt: which burst.
 */
function burst(size, t, colours, salt) {
    const rows = [];
    for (let y = 0; y < size; y++) rows.push(new Array(size).fill('.'));
    const c = (size - 1) / 2, rMax = size / 2 - 0.5, rays = size >= 24 ? 16 : 10;
    const put = (x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < size && y < size) rows[y][x] = ch; };
    // a steady pseudo-random number per ray (no Math.random: the pictures are the same each run)
    const rnd = (n) => { const v = Math.sin((n + 1) * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };
    const outer = 1.5 + t * (rMax - 1.5);
    const inner = outer * (0.25 + 0.7 * t);
    for (let k = 0; k < rays; k++) {
        const a = (k + rnd(k) * 0.6) * 2 * Math.PI / rays, reach = outer * (0.7 + 0.3 * rnd(k + 40));
        for (let r = inner; r <= reach; r += 0.8) {
            const f = (r - inner) / Math.max(0.01, reach - inner);
            const ch = colours[Math.min(colours.length - 1, 1 + Math.floor((0.35 * t + 0.65 * f) * (colours.length - 1)))];
            put(c + Math.cos(a) * r, c + Math.sin(a) * r, ch);
        }
    }
    // the hot core, shrinking away
    const core = (1 - t) * size / 5;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - c, y - c);
        if (d <= core) put(x, y, d <= core * 0.55 ? colours[0] : colours[1]);
    }
    return sprite(rows.map((r) => r.join('')), C);
}
const frames = (size, n, colours, salt) => { const out = []; for (let i = 0; i < n; i++) out.push(burst(size, (i + 0.5) / n, colours, salt)); return out; };
const BOOM = frames(16, 5, ['W', 'Y', 'O', 'R'], 1);          // one of the swarm
const BOOM_SHIP = frames(32, 8, ['W', 'C', 'T', 'O', 'R'], 2);  // the player's ship

/* ---------- turned copies for flying ---------- */
const STEPS = 16;
const turns = (spr) => { const out = []; for (let k = 0; k < STEPS; k++) out.push(k ? rotate(spr, k * 2 * Math.PI / STEPS) : spr); return out; };
/** which of the 16 turned pictures shows a turn of a radians (clockwise) */
const turnIndex = (a) => ((Math.round(a * STEPS / (2 * Math.PI)) % STEPS) + STEPS) % STEPS;

const KINDS = {
    dart: { name: 'DART', frames: DART.map(turns) },
    claw: { name: 'CLAW', frames: CLAW.map(turns) },
    warden: { name: 'WARDEN', frames: WARDEN.map(turns), hurt: WARDEN_HURT.map(turns) },
};

module.exports = {
    C, SHIP, SHIP_TURNS: turns(SHIP), SHIP_HELD, SHIP_HELD_TURNS: turns(SHIP_HELD), DART, CLAW, WARDEN, WARDEN_HURT,
    BOLT, BOMB, MARK1, MARK5, MARK10, BOOM, BOOM_SHIP, KINDS, STEPS, turnIndex,
};
