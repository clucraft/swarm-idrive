'use strict';
/**
 * paths.js - how the swarm flies: every route is a short list of moves for a "turtle" that has a
 * place, a heading and a speed.
 *
 *   ['f', px]            straight on for px pixels
 *   ['a', degrees, r]    an arc of that many degrees on a circle of radius r; positive turns
 *                        clockwise on the screen (down -> left -> up -> right)
 *
 * Headings are in radians: 0 = right, PI / 2 = down, PI = left, -PI / 2 = up (y grows downwards).
 * A route starts at { x, y, h (degrees) }. mirror() gives the same route from the other side.
 */
const RAD = Math.PI / 180;

/** A flier following route r (mirrored: from the other side of a field w wide). */
function begin(e, r, mirrored, w) {
    e.x = mirrored ? w - r.x : r.x;
    e.y = r.y;
    e.h = (mirrored ? 180 - r.h : r.h) * RAD;
    e.path = r.moves;
    e.flip = mirrored ? -1 : 1;
    e.pc = 0;
    e.rem = -1;
}

/** Start the moves list `moves` from where the flier is and the way it points. */
function follow(e, moves, flip) {
    e.path = moves;
    e.flip = flip || 1;
    e.pc = 0;
    e.rem = -1;
}

/**
 * Move the flier `dist` pixels along its route. Returns false once the route is flown out
 * (any distance left over is flown straight on, so a line of fliers keeps its spacing).
 */
function advance(e, dist) {
    let left = dist;
    while (left > 1e-9 && e.pc < e.path.length) {
        const m = e.path[e.pc];
        if (e.rem < 0) e.rem = m[0] === 'f' ? m[1] : Math.abs(m[1]) * RAD * m[2];
        const d = Math.min(left, e.rem);
        if (m[0] === 'f') {
            e.x += Math.cos(e.h) * d; e.y += Math.sin(e.h) * d;
        } else {
            // half the turn, the step, the other half: the chord of the little arc
            const dh = (m[1] < 0 ? -1 : 1) * e.flip * d / m[2];
            e.h += dh / 2;
            e.x += Math.cos(e.h) * d; e.y += Math.sin(e.h) * d;
            e.h += dh / 2;
        }
        e.rem -= d; left -= d;
        if (e.rem <= 1e-9) { e.pc++; e.rem = -1; }
    }
    if (left > 1e-9) { e.x += Math.cos(e.h) * left; e.y += Math.sin(e.h) * left; }
    return e.pc < e.path.length;
}

/** Turn heading h towards the point (tx, ty) from (x, y), by at most maxTurn radians. */
function steer(h, x, y, tx, ty, maxTurn) {
    const want = Math.atan2(ty - y, tx - x);
    let d = want - h;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (d > maxTurn) d = maxTurn; else if (d < -maxTurn) d = -maxTurn;
    return h + d;
}

/* ---------- the routes (for a 320 x 240 field; "L" ones swing through the left half) ---------- */
const ROUTES = {
    // into the formation: down from the top, a wide swing through the lower left, up again
    topL: { x: 150, y: -12, h: 90, moves: [['f', 16], ['a', 28, 70], ['f', 96], ['a', 250, 34]] },
    // the same with a tighter, deeper hook
    topDeepL: { x: 138, y: -12, h: 90, moves: [['f', 30], ['a', 40, 60], ['f', 104], ['a', 265, 26]] },
    // in from the lower left, one loop, then up the side
    sideL: { x: -12, y: 196, h: -20, moves: [['f', 70], ['a', -360, 26], ['a', -70, 80]] },
    // in from the left at half height, an S through the middle
    midL: { x: -12, y: 120, h: 10, moves: [['f', 60], ['a', 120, 30], ['a', -210, 30], ['f', 20]] },

    // bonus run: straight through, never joining a formation
    runA: { x: 140, y: -12, h: 90, moves: [['f', 60], ['a', 180, 46], ['f', 24], ['a', 180, 30], ['f', 50], ['a', -90, 36], ['f', 420]] },
    runB: { x: -12, y: 64, h: 0, moves: [['f', 110], ['a', 360, 34], ['f', 50], ['a', 90, 44], ['f', 60], ['a', -180, 30], ['f', 420]] },
    runC: { x: -12, y: 186, h: -45, moves: [['f', 110], ['a', -270, 38], ['f', 40], ['a', 180, 28], ['f', 420]] },
    runD: { x: 100, y: -12, h: 90, moves: [['f', 150], ['a', -180, 40], ['f', 60], ['a', 360, 22], ['f', 420]] },
};

/** A swarm ship leaving its place in the formation: up and over to the side, to point down. */
const LAUNCH = [['a', 180, 12]];
/** One loop in the middle of a dive. */
const LOOP = [['a', 360, 15]];

module.exports = { ROUTES, LAUNCH, LOOP, begin, follow, advance, steer, RAD };
