'use strict';
/**
 * controls.js - the car as a game controller, and the check that it is parked.
 *
 *   iDrive controller   turn: the ship moves left / right, a fixed distance per click
 *                       press: fire (when the guns don't fire by themselves), and start
 *   accelerator pedal   the ship's place between the back row (released) and far forward
 *
 * What the car sends the head unit on its own:
 *
 *   controller    de.bmw.infotainment.controlelements.FrontCCU . statusRotaryEncoderState
 *                 frontRotaryEncoderOperation: the knob's click counter (16 bit, wraps),
 *                 frontRotaryEncoderPushButton: pressed or not  (as the kit's Doom reads them)
 *   accelerator   de.bmw.powertrain.AcceleratorPedal . AngleAcceleratorPedal . actualValueAngleAcceleratorPedal
 *                 0.025 % a step (the kit's Live Data value: its best guess, not measured on a
 *                 car by this project; the pedal gauge on the game screen shows what arrives)
 *   selector      de.bmw.infrastructure.VehicleInformation . statusGearboxDrive / DataPowerTrain2
 *
 * read()  -> { x: -1 .. 1, y: 0 .. 1, live }           for Game.setControl
 * park()  -> { ok, why: [lines] }                      the game runs only while ok
 *
 * Parked means: the selector is in P and the car stands. The pedal is a control of this game, so
 * "probably standing" is not enough: with a drive gear selected, pressing it moves the car. When
 * the car sends pedal or speed data but no selector position, the game does not start.
 *
 * Nothing here needs the head unit: the tests feed it values.
 */
const PEDAL_K = 0.025;        // percent per step
const PEDAL_DEAD = 2;         // percent of pedal travel that count as "released"
const INVALID = 15;           // FrontCCU: SIGNAL_UNGUELTIG

// FrontCCU.frontRotaryEncoderPushButton: the SDK hands enums over by name (numbers accepted too)
const PUSH = { KEINE_BETAETIGUNG: 0, DREHGEBER_KURZ_GEDRUECKT: 1, DREHGEBER_LANG_GEDRUECKT: 2, UNWIRKSAM: 3, SIGNAL_UNGUELTIG: INVALID };
// VehicleInformation.statusGearboxDrive.statusActualStageDrive: names or wire numbers
const STAGES = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The number a signal's struct carries: its member `name`, else its one member named like `like`. */
function member(v, name, like) {
    if (typeof v === 'number') return v;
    if (!v || typeof v !== 'object') return null;
    if (typeof v[name] === 'number') return v[name];
    const others = Object.keys(v).filter((k) => typeof v[k] === 'number' && like.test(k) && !/crc|alive|counter|qualifier|quality/i.test(k));
    return others.length === 1 ? v[others[0]] : null;
}

class Controls {
    /** opts: { log: { info, warn }, half: pixels the ship can go each side of the middle } */
    constructor(opts) {
        opts = opts || {};
        this.log = opts.log || { info() {}, warn() {} };
        this.half = opts.half || 148;
        this.step = 12;             // pixels the ship moves per click of the knob
        this.reversed = false;      // turning right moves it left
        this.travel = 50;           // percent of the pedal's travel for "all the way forward"
        this.x = 0;                 // where the knob has put the ship: -1 .. 1
        this.count = null;          // the knob's click counter as last sent
        this.active = false;        // turns move the ship (the game is on and may run)
        this.fire = false;          // the controller is pressed
        this.knobLive = false;
        this.pct = null;            // pedal, percent; null: nothing from the car yet
        this.rest = null;           // the lowest pedal value seen: its released position
        this.box = null; this.sel = null;       // selector position from each of its two signals
        this.seen = {};             // what was logged once
    }

    configure(o) {
        if (o.step > 0) this.step = Number(o.step);
        if (o.travel > 0) this.travel = Number(o.travel);
        this.reversed = !!o.reversed;
    }

    _once(key, text) { if (!this.seen[key]) { this.seen[key] = true; this.log.info(text); } }

    /* ---------- what the car sends ---------- */

    /**
     * FrontCCU.statusRotaryEncoderState. Returns { press: the press changed, turned: clicks (right
     * positive) that moved the ship }.
     */
    onKnob(v) {
        const out = { press: false, turned: 0 };
        if (!v) return out;
        const pb = v.frontRotaryEncoderPushButton, df = v.frontRotaryEncoderDeflection;
        const push = typeof pb === 'number' ? pb : pb != null && PUSH[pb] != null ? PUSH[pb] : INVALID;
        const tilt = typeof df === 'number' ? df : df === 'SIGNAL_UNGUELTIG' || df == null ? INVALID : 0;
        // no controller behind it (a head unit on a bench): everything "invalid"
        if (push === INVALID && tilt === INVALID) return out;
        if (!this.knobLive) { this.knobLive = true; this.log.info('controller: live'); }
        const down = push === 1 || push === 2;
        if (down !== this.fire) { this.fire = down; out.press = true; }
        // the knob: a click counter that wraps at 16 bits; a big jump is a reset, not a turn
        const c = v.frontRotaryEncoderOperation;
        if (typeof c === 'number') {
            if (this.count !== null) {
                const d = ((c - this.count + 32768) & 0xffff) - 32768;
                if (d && Math.abs(d) <= 64 && this.active) {
                    out.turned = d;
                    this.x = clamp(this.x + (this.reversed ? -d : d) * this.step / this.half, -1, 1);
                }
            }
            this.count = c;
        }
        return out;
    }

    onPedal(v) {
        const raw = member(v, 'actualValueAngleAcceleratorPedal', /pedal|angle/i);
        if (raw === null) { this._once('pedal?', 'pedal: no value in ' + JSON.stringify(v)); return; }
        const pct = raw * PEDAL_K;
        if (!(pct >= -2 && pct <= 102)) return;              // "no value"
        this._once('pedal', 'pedal: live (' + pct.toFixed(1) + ' %, raw ' + raw + ')');
        this.pct = pct;
        if (this.rest === null || pct < this.rest) this.rest = pct;
    }

    /** statusGearboxDrive: the selector's stage and the gear (which can't tell N from P). */
    onGearbox(v) {
        if (!v) return;
        const stage = STAGES[v.statusActualStageDrive], g = v.statusActualGearDrive;
        let s = null;
        if (stage) s = stage;
        else if (g === 'N_OR_P' || g === 2) s = 'NP';
        else if (g === 'R' || g === 1) s = 'R';
        else if ((typeof g === 'number' && g >= 3 && g <= 12) || /^G\d+$/.test(String(g))) s = 'D';
        if (s === null) return;
        if (s !== this.box) this.log.info('selector (gearbox): ' + s);
        this.box = s;
    }

    /** DataPowerTrain2.statusGearSelectionDrive: N = 1, R = 2, P = 3, N or P = 4, 1st .. 9th = 5 .. 13. */
    onSelection(v) {
        const x = v && v.statusGearSelectionDrive;
        const n = typeof x === 'number' ? x : { N: 1, R: 2, P: 3, NP: 4 }[x] || (/^_\d$/.test(String(x)) ? 4 + Number(String(x).slice(1)) : 0);
        const s = n === 1 ? 'N' : n === 2 ? 'R' : n === 3 ? 'P' : n === 4 ? 'NP' : n >= 5 && n <= 13 ? 'D' : null;
        if (s === null) return;
        if (s !== this.sel) this.log.info('selector (selection): ' + s);
        this.sel = s;
    }

    /* ---------- what the game gets ---------- */

    /** Turns move the ship only while the game is on screen and may run. */
    setActive(on) { this.active = !!on; }

    /** The ship back to the middle (a new game). */
    recentre() { this.x = 0; }

    /** percent of the pedal's own travel above its released position, or null */
    pedal() { return this.pct === null ? null : Math.max(0, this.pct - (this.rest || 0)); }

    read() {
        const p = this.pedal();
        return {
            x: this.x,
            y: p === null ? 0 : clamp((p - PEDAL_DEAD) / Math.max(1, this.travel - PEDAL_DEAD), 0, 1),
            live: this.knobLive || p !== null,
            pedalLive: p !== null,
        };
    }

    /** the selector: 'P', 'R', 'N', 'D', 'NP' (N or P, the car doesn't say which) or null (not told) */
    selector() {
        const a = this.box, b = this.sel;
        for (const s of ['R', 'D']) if (a === s || b === s) return s;        // a drive gear on either signal counts
        for (const s of ['P', 'N', 'NP']) if (a === s || b === s) return s;
        return null;
    }

    /**
     * May the game run? moving: the car drives (kit/parked.js); speedKnown: the car sends a speed.
     * why: two short lines for the game's screen when not; say: the same as a sentence (the menu).
     */
    park(moving, speedKnown) {
        const s = this.selector();
        if (moving) return { ok: false, selector: s, why: ['THE CAR IS MOVING', 'THE GAME WAITS UNTIL IT IS PARKED'], say: 'the car is moving' };
        if (s === 'R' || s === 'D' || s === 'N') return { ok: false, selector: s, why: ['SHIFT TO P TO PLAY', 'THE SELECTOR IS IN ' + s], say: 'the selector is in ' + s + ', shift to P' };
        if (s === 'P' || s === 'NP') return { ok: true, selector: s, why: null };
        // not told where the selector is: fine with no car at all (the emulator, a bench), not in a car
        if (this.pct !== null || speedKnown) return { ok: false, selector: null, why: ['WAITING FOR THE GEAR SELECTOR', 'THE GAME NEEDS TO SEE IT IN P'], say: 'the car has not said where the selector is yet' };
        return { ok: true, selector: null, why: null, noCar: true };
    }
}

module.exports = { Controls, PEDAL_K, PEDAL_DEAD };
