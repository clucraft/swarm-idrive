'use strict';
/**
 * panels.js - the two panels beside the playfield on the wide screen: how to play on the left,
 * what the car's controls are doing right now on the right (also the first place to look when the
 * ship doesn't follow the pedal: the gauges show what the app receives).
 *
 * Each panel is its own 160 x 240 picture, drawn again only when what it shows has changed.
 */
const { Surface } = require('./gfx');
const { C } = require('./sprites');

const PW = 160, PH = 240;
const BG = [6, 8, 26], EDGE = [28, 44, 140], DIM = [96, 104, 128];

class Panel {
    constructor() { this.s = new Surface(PW, PH); this.key = null; }
    /** true when the picture changed (then it has to be sent again) */
    update(key, draw) {
        if (key === this.key) return false;
        this.key = key;
        this.s.clear(BG);
        draw(this.s);
        return true;
    }
}

/** Left: how to play. The HMI's back arrow column covers the screen's left edge: text from x = 34. */
function drawHelp(s, o) {
    const x = 34;
    s.rect(PW - 1, 0, 1, PH, EDGE);
    s.text('HOW TO PLAY', x, 18, C.Y);
    s.text('CONTROLLER', x, 44, C.C);
    s.text('TURN = MOVE', x, 55, C.W);
    s.text(o.autoFire ? 'PRESS = START' : 'PRESS = FIRE', x, 66, C.W);
    s.text('GAS PEDAL', x, 89, C.C);
    s.text('FLY FORWARD', x, 100, C.W);
    s.text('LET OFF = BACK', x, 111, C.W);
    s.text('GUNS', x, 134, C.C);
    s.text(o.autoFire ? 'FIRE THEMSELVES' : 'HOLD = RAPID', x, 145, C.W);
    s.text('BACK BUTTON', x, 168, C.C);
    s.text('PAUSE / MENU', x, 179, C.W);
    s.text('PARKED ONLY', x, 204, DIM);
    s.text('SELECTOR IN P', x, 215, DIM);
}

/**
 * Right: the controls live. o: { knob (the controller is there), x (-1 .. 1: where it has put the ship),
 * pedal (percent of its travel, or null), y (0 .. 1), selector, speed (km/h or null), autoFire, fire,
 * state: [line, colour, second line] }
 */
function drawGauges(s, o) {
    const x = 8, w = 136;
    s.rect(0, 0, 1, PH, EDGE);
    s.text('CONTROLS', x, 18, C.Y);

    s.text('SHIP', x, 44, C.C);
    s.textR(o.knob ? (o.x < -0.005 ? 'LEFT' : o.x > 0.005 ? 'RIGHT' : 'MIDDLE') : '--', x + w, 44, C.W);
    s.frame(x, 56, w, 11, DIM);
    s.rect(x + w / 2, 54, 1, 15, DIM);
    if (o.knob) s.rect(x + 3 + Math.round((o.x + 1) / 2 * (w - 11)), 58, 5, 7, C.Y);

    s.text('PEDAL', x, 80, C.C);
    s.textR(o.pedal === null ? '--' : Math.round(o.pedal) + '%', x + w, 80, C.W);
    s.frame(x, 92, w, 11, DIM);
    if (o.pedal !== null) s.rect(x + 2, 94, Math.round(o.y * (w - 4)), 7, o.y >= 1 ? C.O : C.G);

    s.text('SELECTOR', x, 116, C.C);
    const sel = o.selector === 'NP' ? 'P/N' : o.selector || '--';
    s.textR(sel, x + w, 116, o.selector === 'P' || o.selector === 'NP' ? C.G : o.selector ? C.R : DIM);
    s.text('SPEED', x, 130, C.C);
    s.textR(o.speed === null ? '--' : String(Math.round(o.speed)), x + w, 130, o.speed > 3 ? C.R : C.W);

    s.text('GUNS', x, 152, C.C);
    s.textR(o.autoFire ? 'AUTO' : o.fire ? 'FIRE' : 'READY', x + w, 152, o.fire && !o.autoFire ? C.Y : C.W);

    s.text(o.state[0], x, 204, o.state[1]);
    if (o.state[2]) s.text(o.state[2], x, 215, o.state[1]);
}

module.exports = { Panel, drawHelp, drawGauges, PW, PH };
