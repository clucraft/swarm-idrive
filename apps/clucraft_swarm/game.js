'use strict';
/**
 * game.js - Swarm Drive, the game itself: a fixed shooter in the manner of the early-1980s arcade
 * machines. A swarm flies in, takes up a formation over the player and dives out of it to attack;
 * the player's ship is moved by two numbers,
 *
 *   x  -1 (far left) .. 1 (far right)     the iDrive controller, turned
 *   y   0 (back row) .. 1 (far forward)   the accelerator pedal
 *
 * and fires either by itself (autoFire) or while the fire button is held (the controller,
 * pressed). Either way two shots are in the air at most, as on the old machines. The same press
 * starts a game.
 *
 * The game knows nothing about the car or the head unit: main.js feeds it those numbers
 * (controls.js), steps it 60 times a second and shows the picture it draws. The tests run it
 * under plain Node with a robot at the controls.
 *
 * Playfield: 320 x 240 pixels. Top 18 rows: scores. Bottom 16 rows: ships in reserve and the
 * stage markers. The ship flies between y = 208 (pedal released) and y = 144 (pedal down).
 */
const SP = require('./sprites');
const P = require('./paths');

const FW = 320, FH = 240;
const TOP = 18, BOTTOM = 224;
const BASE_Y = 208, TRAVEL = 64;
const COLS = 10, ROW_Y = [42, 58, 74, 90, 106], SLOT_DX = 17;
const BEAM_Y = 124, BEAM_OUT = 30, BEAM_HOLD = 110, BEAM_IN = 30, BEAM_ALL = BEAM_OUT + BEAM_HOLD + BEAM_IN;
const POINTS = { dart: [50, 100], claw: [80, 160], warden: [150, 400], held: [500, 500] };
const ESCORT_POINTS = [400, 800, 1600];
const BONUS_HIT = 100, BONUS_PERFECT = 10000, RESCUE_POINTS = 1000;
const FIRST_EXTRA = 20000, NEXT_EXTRA = 50000;
const COOL = 14;                    // frames between two shots: automatic fire, or the fire button held
const COOL_TAP = 7;                 // ... pressing the fire button again and again
const C = SP.C, BLACK = [0, 0, 0], DIM = [96, 104, 128];
const RAD = P.RAD, DOWN = Math.PI / 2, UP = -Math.PI / 2;
const FLYING = { launch: 1, dive: 1, loop: 1, toBeam: 1, beam: 1 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** a small seeded random number generator (the tests replay a game from its seed) */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** how hard stage n is */
function tune(n) {
    return {
        entryV: Math.min(3.4, 2.6 + 0.06 * n),          // speed flying in
        diveV: Math.min(3.3, 1.9 + 0.11 * n),           // speed of an attack dive
        bombV: Math.min(3.0, 1.5 + 0.12 * n),           // speed of the swarm's shots
        launchGap: Math.max(42, 150 - 11 * n),          // frames between two attacks leaving the formation
        maxDivers: Math.min(6, 2 + Math.floor(n / 2)),  // attackers in the air at once
        bombs: n >= 7 ? 3 : n >= 3 ? 2 : 1,             // shots an attacker drops per dive
        maxBombs: Math.min(10, 3 + n),                  // shots in the air at once
        entryBomb: n >= 2 ? Math.min(0.02, 0.003 * n) : 0,   // chance per frame that one flying in drops a shot
    };
}

function mk(kind, col, row, route, mirrored, delay) {
    return {
        kind, col, row, route, mirrored, delay, state: 'queued', alive: true, hp: kind === 'warden' ? 2 : 1,
        x: -99, y: -99, h: DOWN, v: 0, t: 0, captive: false, leader: null, mode: null, seen: false,
    };
}

/** the five groups of eight that make up an ordinary stage */
function swarmWaves(stage) {
    const variant = (stage - 1) % 3, flip = variant === 1;
    const top = variant === 2 ? 'topDeepL' : 'topL', side = variant === 1 ? 'midL' : 'sideL';
    const gap = 8;
    const line = (kind, slots, route, mirrored, every, first) => slots.map((s, i) => mk(kind, s[0], s[1], route, mirrored, (first || 0) + i * (every || 1) * gap));
    return [
        // two lines of four from the top, one each side
        line('claw', [[4, 1], [5, 1], [4, 2], [5, 2]], top, !flip).concat(line('dart', [[4, 3], [5, 3], [4, 4], [5, 4]], top, flip)),
        // Wardens and Claws by turns, one line from the side
        line('warden', [[3, 0], [4, 0], [5, 0], [6, 0]], side, flip, 2).concat(line('claw', [[3, 1], [6, 1], [3, 2], [6, 2]], side, flip, 2, gap)),
        line('claw', [[1, 1], [2, 1], [7, 1], [8, 1], [1, 2], [2, 2], [7, 2], [8, 2]], side, !flip),
        line('dart', [[2, 3], [3, 3], [6, 3], [7, 3], [2, 4], [3, 4], [6, 4], [7, 4]], top, flip),
        line('dart', [[0, 3], [1, 3], [8, 3], [9, 3], [0, 4], [1, 4], [8, 4], [9, 4]], top, !flip),
    ];
}

/** a bonus run: five groups of eight that fly straight through and never shoot */
function bonusWaves(stage) {
    const gap = 8, n = Math.floor(stage / 4);
    const both = (kind, route) => { const out = []; for (let i = 0; i < 4; i++) { out.push(mk(kind, 0, 0, route, false, i * gap)); out.push(mk(kind, 0, 0, route, true, i * gap)); } return out; };
    const one = (kind, route, mirrored) => { const out = []; for (let i = 0; i < 8; i++) out.push(mk(kind, 0, 0, route, mirrored, i * gap)); return out; };
    const waves = [both('dart', 'runA'), one('claw', 'runB', n % 2 === 1), one('claw', 'runB', n % 2 === 0), both('dart', 'runC'), both('warden', 'runD')];
    waves.forEach((w) => w.forEach((e) => { e.hp = 1; }));
    return waves;
}

class Game {
    /** opts: { seed, ships (3), hiScore, autoFire (true) } */
    constructor(opts) {
        opts = opts || {};
        this.rnd = prng(opts.seed || 1);
        this.ships = opts.ships || 3;
        this.hiScore = opts.hiScore || 0;
        this.autoFire = opts.autoFire !== false;
        this.fireHeld = false; this.fireTaps = 0; this.fireFresh = false;
        this.events = [];                   // what happened, for main.js: { type: 'start' | 'over' | 'stage' | 'extra' }
        this.frame = 0;
        this.ctl = { x: 0, y: 0, live: false };
        this.pressed = false;
        this.notice = null;                 // lines main.js wants shown on the title screen in place of "press to start" (why the game waits)
        this.hint = null;                   // one more line under it (e.g. no pedal data)
        this.score = 0; this.stage = 0; this.lives = 0; this.shots = 0; this.hits = 0;
        this.enemies = []; this.bolts = []; this.bombs = []; this.booms = []; this.popups = [];
        this.player = { x: FW / 2, y: BASE_Y, state: 'gone', dual: false, t: 0, inv: 0, cool: 0 };
        this.stars = [];
        const tints = [C.W, C.C, C.Y, C.M, C.B, C.S, C.G];
        for (let i = 0; i < 70; i++) {
            this.stars.push({ x: Math.floor(this.rnd() * FW), y: this.rnd() * FH, v: [0.2, 0.2, 0.45, 0.9][i % 4], c: tints[Math.floor(this.rnd() * tints.length)], ph: Math.floor(this.rnd() * 64) });
        }
        this.toTitle();
    }

    /* ================= what main.js calls ================= */

    /** The controls: x -1 .. 1, y 0 .. 1; live false = nothing is steering (the ship holds the middle of the back row). */
    setControl(x, y, live) {
        this.ctl.live = live !== false;
        this.ctl.x = this.ctl.live ? clamp(Number(x) || 0, -1, 1) : 0;
        this.ctl.y = this.ctl.live ? clamp(Number(y) || 0, 0, 1) : 0;
    }
    /** Start a game (from the title or the results). */
    press() { this.pressed = true; }
    /** The fire button goes down (true) or up (false). Down on the title or the results starts a game. */
    setFire(held) {
        held = !!held;
        if (held && !this.fireHeld) { this.fireFresh = true; if (this.mode !== 'play') this.pressed = true; }
        this.fireHeld = held;
    }
    /** One shot asked for by something that only reports presses (a tapped button). */
    trigger() { if (this.mode !== 'play') this.pressed = true; else if (this.fireTaps < 2) this.fireTaps++; }

    toTitle() {
        this.mode = 'title'; this.t = 0; this.pressed = false;
        this.enemies = []; this.bolts = []; this.bombs = []; this.booms = []; this.popups = [];
        this.capture = null; this.rescue = null; this.msg = null;
        this.player.state = 'gone';
    }

    newGame() {
        this.mode = 'play'; this.t = 0;
        this.score = 0; this.shots = 0; this.hits = 0;
        this.lives = this.ships - 1;
        this.nextExtra = FIRST_EXTRA;
        this.bolts = []; this.bombs = []; this.booms = []; this.popups = [];
        this.capture = null; this.rescue = null; this.msg = null; this.volley = 0;
        this.player = { x: FW / 2 + this.ctl.x * (FW / 2 - 12), y: BASE_Y, state: 'ok', dual: false, t: 0, inv: 0, cool: 30, spin: 0 };
        this.events.push({ type: 'start' });
        this._beginStage(1);
    }

    /** true while a game is being played (not the title, not the results) */
    playing() { return this.mode === 'play'; }

    /** One frame (1 / 60 s). */
    step() {
        this.frame++; this.t++;
        for (const s of this.stars) { s.y += s.v; if (s.y >= FH) { s.y -= FH; s.x = Math.floor(this.rnd() * FW); } }
        const start = this.pressed;
        this.pressed = false;
        if (this.mode === 'title') {
            if (start) this.newGame();
        } else if (this.mode === 'over') {
            if (this.t > 150 && start) this.newGame();
            else if (this.t > 60 * 20) this.toTitle();
        } else this._stepPlay();
    }

    /* ================= a stage ================= */

    _beginStage(n) {
        this.stage = n;
        this.bonus = n % 4 === 3;
        this.tune = tune(n);
        this.phase = 'intro'; this.phaseT = 0;
        this.waves = (this.bonus ? bonusWaves(n) : swarmWaves(n)).map((members) => ({ members, start: -1 }));
        this.enemies = [];
        this.waves.forEach((w) => w.members.forEach((e) => this.enemies.push(e)));
        this.waveIdx = 0;
        this.form = { x: 0, t: 0, bt: 0, spread: 1 };
        this.launchT = 100; this.launchN = 0;
        this.stageHits = 0;
        this.bombs = [];
        this.events.push({ type: 'stage', stage: n });
    }

    /* ================= one frame of play ================= */

    _stepPlay() {
        this.phaseT++;
        this._stepForm();
        this._stepWaves();
        for (const e of this.enemies) if (e.alive) this._stepEnemy(e);
        if (this.phase === 'attack') this._stepAttack();
        this._stepCapture();
        this._stepRescue();
        this._stepPlayer();
        this._stepShots();
        this._collide();
        for (const b of this.booms) b.t++;
        this.booms = this.booms.filter((b) => b.t < b.frames.length * b.rate);
        for (const p of this.popups) { p.t++; p.y -= 0.25; }
        this.popups = this.popups.filter((p) => p.t < 50);
        if (this.msg && --this.msg.t <= 0) this.msg = null;
        this._stepPhase();
    }

    _stepForm() {
        const f = this.form;
        f.t++;
        if (this.phase === 'attack') {
            f.x *= 0.96;
            f.bt++;
            f.spread = 1 + 0.11 * (1 - Math.cos(f.bt * 0.03));      // the formation breathes
        } else f.x = Math.sin(f.t * 0.026) * 14;                    // and sways while it fills up
    }

    _slot(e) {
        return { x: FW / 2 + this.form.x + (e.col - (COLS - 1) / 2) * SLOT_DX * this.form.spread, y: ROW_Y[e.row] };
    }

    _stepWaves() {
        if (this.phase !== 'entry' || this.waveIdx >= this.waves.length) return;
        const prev = this.waveIdx > 0 ? this.waves[this.waveIdx - 1] : null;
        const since = prev ? this.frame - prev.start : 1e9;
        const settled = !prev || prev.members.every((e) => !e.alive || e.state === 'form');
        if (!prev || (settled && since > 50) || since > 330) {
            const w = this.waves[this.waveIdx++];
            w.start = this.frame;
            w.members.forEach((e) => { e.state = 'wait'; e.t = e.delay; });
        }
    }

    _stepPhase() {
        const alive = this.enemies.some((e) => e.alive);
        if (this.phase === 'intro') {
            if (this.phaseT > 110) { this.phase = 'entry'; this.phaseT = 0; }
        } else if (this.phase === 'entry') {
            if (this.waveIdx >= this.waves.length) {
                if (!alive) this._stageDone();
                else if (!this.bonus && this.enemies.every((e) => !e.alive || e.state === 'form')) { this.phase = 'attack'; this.phaseT = 0; }
            }
        } else if (this.phase === 'attack') {
            if (!alive) this._stageDone();
        } else if (this.phase === 'clear') {
            // (a ship being handed back, or taken, finishes first; with no ship left the game ends instead)
            if (this.phaseT > 100 && !this.rescue && !this.capture && this.lives >= 0) this._beginStage(this.stage + 1);
        } else if (this.phase === 'bonusEnd') {
            if (this.phaseT === 90) {
                this._add(this.stageHits * BONUS_HIT);
                if (this.stageHits === 40) this._add(BONUS_PERFECT);
            }
            if (this.phaseT > 260) this._beginStage(this.stage + 1);
        }
    }

    _stageDone() {
        if (this.booms.length || this.bombs.length) return;       // let the last blast play out
        this.phase = this.bonus ? 'bonusEnd' : 'clear';
        this.phaseT = 0;
    }

    /* ================= the swarm ================= */

    _stepEnemy(e) {
        const p = this.player;
        switch (e.state) {
        case 'wait':
            if (--e.t < 0) {
                P.begin(e, P.ROUTES[e.route], e.mirrored, FW);
                e.v = this.tune.entryV;
                e.state = this.bonus ? 'run' : 'path';
            }
            break;
        case 'path':
            if (!P.advance(e, e.v)) e.state = 'home';
            else if (this.tune.entryBomb && e.y > 60 && e.y < 150 && Math.sin(e.h) > 0.5 && this.rnd() < this.tune.entryBomb) this._bomb(e);
            break;
        case 'run': {
            const more = P.advance(e, e.v);
            const on = e.x > -14 && e.x < FW + 14 && e.y > -14 && e.y < FH + 14;
            if (on) e.seen = true;
            if (!more || (e.seen && !on)) { e.alive = false; e.state = 'gone'; }
            break;
        }
        case 'home': {
            const s = this._slot(e), d = Math.hypot(s.x - e.x, s.y - e.y);
            if (d < e.v + 1.5) { e.x = s.x; e.y = s.y; e.h = DOWN; e.state = 'form'; e.leader = null; e.mode = null; } else {
                // (tighter the nearer it is, so it never circles its place)
                e.h = P.steer(e.h, e.x, e.y, s.x, s.y, d < 14 ? Math.PI : d < 44 ? 20 * RAD : 7 * RAD);
                e.x += Math.cos(e.h) * e.v; e.y += Math.sin(e.h) * e.v;
            }
            break;
        }
        case 'form': {
            const s = this._slot(e);
            e.x = s.x; e.y = s.y; e.h = DOWN;
            break;
        }
        case 'launch':
            if (!P.advance(e, e.v)) { e.state = e.mode === 'beam' ? 'toBeam' : 'dive'; e.t = 0; }
            break;
        case 'loop':
            if (!P.advance(e, e.v)) e.state = 'dive';
            break;
        case 'dive': {
            e.t++;
            const px = p.state === 'ok' ? p.x : e.aim;
            e.aim += (px + e.off - e.aim) * 0.02;
            e.h = P.steer(e.h, e.x, e.y, e.aim + Math.sin(e.t * e.wf) * e.wa, FH + 40, e.turn);
            e.x += Math.cos(e.h) * e.v; e.y += Math.sin(e.h) * e.v;
            if (e.bombs > 0 && e.y > e.nextBomb && e.y < p.y - 26) { this._bomb(e); e.bombs--; e.nextBomb += 30; }
            if (e.kind === 'claw' && !e.looped && e.y > 126 && e.y < 150) { e.looped = true; P.follow(e, P.LOOP, e.x < FW / 2 ? 1 : -1); e.state = 'loop'; }
            if (e.y > FH + 12) this._wrap(e);
            break;
        }
        case 'toBeam': {
            const d = Math.hypot(e.bx - e.x, BEAM_Y - e.y);
            if (d < e.v + 1) { e.x = e.bx; e.y = BEAM_Y; e.h = DOWN; e.state = 'beam'; e.t = 0; } else {
                e.h = P.steer(e.h, e.x, e.y, e.bx, BEAM_Y, d < 30 ? 0.6 : 6 * RAD);
                e.x += Math.cos(e.h) * e.v; e.y += Math.sin(e.h) * e.v;
            }
            break;
        }
        case 'beam': {
            const towing = this.capture && this.capture.warden === e;
            // (the beam stays out while it pulls a ship in)
            if (!(towing && !this.capture.done && e.t >= BEAM_OUT + BEAM_HOLD - 1)) e.t++;
            if (!this.capture && p.state === 'ok' && !p.dual && p.inv <= 0 && this._inBeam(e, p.x, p.y)) {
                this.capture = { warden: e, done: false };
                p.state = 'towed'; p.spin = 0;
                this.bolts = [];
            }
            if (e.t >= BEAM_ALL) {
                if (e.captive) { e.state = 'home'; e.h = UP; e.v = this.tune.entryV; } else { this._diveFrom(e, 0); e.state = 'dive'; e.h = DOWN; }
            }
            break;
        }
        default:
        }
    }

    /** How far the capture beam of Warden e is out: 0 .. 1. */
    _beamOut(e) {
        if (e.state !== 'beam') return 0;
        if (e.t < BEAM_OUT) return e.t / BEAM_OUT;
        if (e.t < BEAM_OUT + BEAM_HOLD) return 1;
        return Math.max(0, (BEAM_ALL - e.t) / BEAM_IN);
    }
    /** Half the beam's width d pixels under the Warden. */
    _beamHalf(d) { return 6 + d * 0.24; }
    _inBeam(e, x, y) {
        const out = this._beamOut(e), top = e.y + 8, d = y - top;
        return out > 0.3 && d > 0 && y - 6 < top + out * (BOTTOM - top) && Math.abs(x - e.x) < this._beamHalf(d) + 2;
    }

    /** Dive settings for e, aiming off px beside the player. */
    _diveFrom(e, off) {
        const amp = { dart: 22, claw: 46, warden: 30, held: 36 }[e.kind];
        e.aim = this.player.state === 'ok' ? this.player.x : e.x;
        e.off = off;
        e.wa = amp; e.wf = 0.05 + this.rnd() * 0.03;
        e.turn = 3 * RAD;
        e.v = this.tune.diveV;
        e.t = Math.floor(this.rnd() * 60);
        e.bombs = this.tune.bombs; e.nextBomb = 96 + this.rnd() * 24;
        e.looped = false;
    }

    /** e leaves its place in the formation. mode: 'dive' or 'beam' (a Warden's capture run). */
    _launch(e, mode, off) {
        e.mode = mode;
        e.h = UP;
        e.v = this.tune.diveV;
        P.follow(e, P.LAUNCH, e.x < FW / 2 ? -1 : 1);
        e.state = 'launch';
        this._diveFrom(e, off || 0);
        if (mode === 'beam') e.bx = clamp(this.player.x, 40, FW - 40);
    }

    /** Off the bottom of the screen: back in at the top. */
    _wrap(e) {
        if (e.kind === 'held') { e.alive = false; e.state = 'gone'; return; }
        e.y = -12; e.h = DOWN; e.leader = null;
        const left = this.enemies.reduce((n, x) => n + (x.alive ? 1 : 0), 0);
        if (this.phase === 'attack' && left <= 3 && this.player.state === 'ok') {
            // the last few never go home: straight back down
            e.x = clamp(this.player.x + (this.rnd() - 0.5) * 140, 20, FW - 20);
            this._diveFrom(e, 0);
            e.state = 'dive';
        } else {
            e.x = this._slot(e).x;
            e.v = this.tune.entryV;
            e.state = 'home';
        }
    }

    _flying() { return this.enemies.reduce((n, e) => n + (e.alive && FLYING[e.state] ? 1 : 0), 0); }

    /** The formation is complete: every so often somebody dives out of it. */
    _stepAttack() {
        const p = this.player;
        if (p.state !== 'ok' || this.capture || this.rescue) return;
        const inForm = this.enemies.filter((e) => e.alive && e.state === 'form');
        const left = this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
        if (--this.launchT > 0 && !(left <= 3 && inForm.length)) return;
        if (!inForm.length || this._flying() >= this.tune.maxDivers) return;
        this.launchT = this.tune.launchGap * (0.7 + 0.6 * this.rnd());
        const n = this.launchN++;
        // by turns: Dart, Claw, Dart, Warden - whoever of that kind sits furthest out, left and right by turns
        const order = [['dart', 'claw', 'warden'], ['claw', 'dart', 'warden'], ['dart', 'claw', 'warden'], ['warden', 'claw', 'dart']][n % 4];
        let pick = null;
        for (const kind of order) {
            const c = inForm.filter((e) => e.kind === kind);
            if (!c.length) continue;
            const side = n % 2 ? 1 : -1;
            c.sort((a, b) => (b.col - 4.5) * side - (a.col - 4.5) * side || b.row - a.row);
            pick = c[0];
            break;
        }
        if (!pick) return;
        if (pick.kind !== 'warden') { this._launch(pick, 'dive', 0); return; }
        // a Warden: a capture run when nobody holds a ship and the player flies one ship, else an attack with escorts
        const holding = this.enemies.some((e) => e.alive && (e.captive || e.kind === 'held'));
        if (!holding && !p.dual && !pick.captive && this.rnd() < 0.55) { this._launch(pick, 'beam', 0); return; }
        this._launch(pick, 'dive', 0);
        const escorts = inForm.filter((e) => e.kind === 'claw' && e.row === 1 && Math.abs(e.col - pick.col) <= 1).slice(0, 2);
        escorts.forEach((e, i) => { this._launch(e, 'dive', i ? 20 : -20); e.leader = pick; });
    }

    _bomb(e) {
        const p = this.player;
        if (this.bombs.length >= this.tune.maxBombs || this.bonus) return;
        const vy = this.tune.bombV, frames = Math.max(1, (p.y - e.y) / vy);
        this.bombs.push({ x: e.x, y: e.y + 6, vx: clamp((p.x - e.x) / frames, -0.9, 0.9), vy });
    }

    /* ================= capture and rescue ================= */

    _stepCapture() {
        const c = this.capture;
        if (!c) return;
        const p = this.player, e = c.warden;
        if (!e.alive) {
            // its captor was shot while it pulled: the ship is free again
            if (p.state === 'towed') { p.state = 'ok'; p.inv = 40; }
            this.capture = null;
            return;
        }
        if (c.done) { if (e.state === 'form' || e.state === 'home') this.capture = null; return; }
        p.spin += 0.45;
        p.x += clamp(e.x - p.x, -1.5, 1.5);
        p.y -= 1.1;
        if (p.y <= e.y + 18) {
            c.done = true;
            e.captive = true;
            e.t = Math.max(e.t, BEAM_OUT + BEAM_HOLD);          // the beam goes in
            this._say('SHIP CAPTURED', C.R, 150);
            this._lose();
        }
    }

    /** where the ship a Warden holds is drawn: behind it */
    _heldAt(e) { return { x: e.x - Math.cos(e.h) * 16, y: e.y - Math.sin(e.h) * 16 }; }

    _stepRescue() {
        const r = this.rescue;
        if (!r) return;
        const p = this.player;
        r.t++; r.spin += 0.4;
        if (r.t < 45) return;
        const ok = p.state === 'ok';
        const tx = ok ? p.x + 16 : r.x, ty = ok ? p.y : BASE_Y;
        r.x += clamp(tx - r.x, -2.5, 2.5); r.y += clamp(ty - r.y, -1.6, 1.6);
        if (Math.abs(tx - r.x) < 1 && Math.abs(ty - r.y) < 1) {
            this.rescue = null;
            if (ok) { p.dual = true; p.x += 8; p.inv = Math.max(p.inv, 30); } else this.lives++;     // (nobody to join: back to the reserve)
        }
    }

    /* ================= the player ================= */

    _stepPlayer() {
        const p = this.player;
        if (p.state === 'ok') {
            const margin = p.dual ? 20 : 12;
            const tx = FW / 2 + this.ctl.x * (FW / 2 - margin), ty = BASE_Y - this.ctl.y * TRAVEL;
            p.x = clamp(p.x + clamp(tx - p.x, -6, 6), margin, FW - margin);
            p.y += clamp(ty - p.y, -3, 3);
            if (p.inv > 0) p.inv--;
            if (p.cool > 0) p.cool--;
            // the guns: by themselves, or on the fire button (a fresh press may come sooner than a held one
            // repeats). Two shots in the air at most.
            const firing = this.phase === 'entry' || this.phase === 'attack';
            const fresh = this.fireFresh || this.fireTaps > 0;
            const wanted = this.autoFire || this.fireHeld || fresh;
            if (firing && wanted && p.cool <= (fresh && !this.autoFire ? COOL - COOL_TAP : 0) && this._volleys() < 2) {
                const v = ++this.volley;
                if (p.dual) { this.bolts.push({ x: p.x - 8, y: p.y - 10, v }, { x: p.x + 8, y: p.y - 10, v }); this.shots += 2; } else { this.bolts.push({ x: p.x, y: p.y - 10, v }); this.shots++; }
                p.cool = COOL;
                this.fireFresh = false;
                if (this.fireTaps > 0) this.fireTaps--;
            }
            if (!firing) { this.fireFresh = false; this.fireTaps = 0; }
        } else if (p.state === 'dead' || p.state === 'gone') {
            p.t++;
            if (this.lives < 0) {
                if (p.t > 170 && !this.capture) this._over();
                return;
            }
            // the next ship comes once the air is clear (or after a while, whatever is up there)
            const calm = !this._flying() && !this.bombs.length && !this.capture;
            if (p.t > 110 && (calm || p.t > 420) && this.phase !== 'intro') { p.state = 'ready'; p.t = 0; }
        } else if (p.state === 'ready') {
            if (++p.t > 70) {
                p.state = 'ok'; p.dual = false; p.inv = 70; p.cool = 20;
                p.x = FW / 2 + this.ctl.x * (FW / 2 - 12); p.y = BASE_Y;
            }
        }
    }

    _volleys() { const seen = {}; let n = 0; for (const b of this.bolts) if (!seen[b.v]) { seen[b.v] = 1; n++; } return n; }

    /** A ship is lost (shot, rammed or captured). */
    _lose() {
        const p = this.player;
        this.lives--;
        p.state = p.state === 'towed' ? 'gone' : 'dead';
        p.t = 0; p.dual = false;
        this.bolts = [];
    }

    /** The ship at x was hit (with two ships flying: only that one goes). */
    _hitShip(x) {
        const p = this.player;
        this.booms.push({ x, y: p.y, t: 0, frames: SP.BOOM_SHIP, rate: 6 });
        if (p.dual) {
            p.dual = false;
            p.x = x < p.x ? p.x + 8 : p.x - 8;
            p.inv = 40;
            return;
        }
        this._lose();
    }

    _over() {
        this.mode = 'over'; this.t = 0; this.pressed = false;
        if (this.score > this.hiScore) this.hiScore = this.score;
        this.bolts = []; this.bombs = [];
        this.events.push({ type: 'over', score: this.score, stage: this.stage });
    }

    /* ================= shots and hits ================= */

    _stepShots() {
        for (const b of this.bolts) b.y -= 5;
        this.bolts = this.bolts.filter((b) => b.y > TOP - 6);
        for (const b of this.bombs) { b.x += b.vx; b.y += b.vy; }
        this.bombs = this.bombs.filter((b) => b.y < BOTTOM + 4 && b.x > -4 && b.x < FW + 4);
    }

    _add(points) {
        this.score += points;
        if (this.score > this.hiScore) this.hiScore = this.score;
        if (this.score >= this.nextExtra) {
            this.lives++;
            this.nextExtra += this.nextExtra === FIRST_EXTRA ? NEXT_EXTRA : NEXT_EXTRA + 20000;
            this.events.push({ type: 'extra' });
        }
    }

    _say(text, colour, frames) { this.msg = { text, c: colour, t: frames }; }

    /** One of the swarm is shot down (or rammed). */
    _kill(e) {
        e.alive = false;
        this.hits++;
        this.booms.push({ x: e.x, y: e.y, t: 0, frames: SP.BOOM, rate: 4 });
        let pts;
        if (this.bonus) { this.stageHits++; pts = 0; } else if (e.kind === 'warden' && e.state !== 'form') {
            const escorts = this.enemies.reduce((n, x) => n + (x.alive && x.leader === e && FLYING[x.state] ? 1 : 0), 0);
            pts = ESCORT_POINTS[Math.min(2, escorts)];
        } else pts = POINTS[e.kind][e.state === 'form' ? 0 : 1];
        if (pts) this._add(pts);
        if (pts >= 400) this.popups.push({ x: e.x, y: e.y, text: String(pts), t: 0 });
        if (e.captive) {
            e.captive = false;
            const at = this._heldAt(e);
            if (e.state === 'form') {
                // shot in the formation: the ship it held turns on the player
                const h = mk('held', e.col, e.row, null, false, 0);
                h.x = at.x; h.y = at.y; h.h = DOWN;
                this._diveFrom(h, 0);
                h.state = 'dive';
                this.enemies.push(h);
            } else {
                // shot in flight: the ship is free and comes back
                this.rescue = { x: at.x, y: at.y, t: 0, spin: 0 };
                this._say('SHIP RESCUED', C.C, 120);
                this._add(RESCUE_POINTS);
                this.popups.push({ x: at.x, y: at.y - 10, text: String(RESCUE_POINTS), t: 0 });
            }
        }
    }

    _collide() {
        const p = this.player;
        // the player's shots against the swarm
        for (const b of this.bolts) {
            for (const e of this.enemies) {
                if (!e.alive || e.state === 'queued' || e.state === 'wait') continue;
                if (Math.abs(b.x - e.x) < 7.5 && Math.abs(b.y - e.y) < 10) {
                    b.y = -99;
                    if (e.hp > 1) { e.hp--; this.hits++; } else this._kill(e);
                    break;
                }
                if (e.captive) {
                    const at = this._heldAt(e);
                    if (Math.abs(b.x - at.x) < 7.5 && Math.abs(b.y - at.y) < 10) {
                        // the player's own ship, shot while it was held
                        b.y = -99; e.captive = false;
                        this.booms.push({ x: at.x, y: at.y, t: 0, frames: SP.BOOM_SHIP, rate: 5 });
                        break;
                    }
                }
            }
        }
        this.bolts = this.bolts.filter((b) => b.y > -50);
        if (p.state !== 'ok' || p.inv > 0 || this.bonus) return;
        const ships = p.dual ? [p.x - 8, p.x + 8] : [p.x];
        for (const sx of ships) {
            if (p.state !== 'ok') break;
            let hit = false;
            for (const b of this.bombs) {
                if (Math.abs(b.x - sx) < 7 && Math.abs(b.y - p.y) < 8) { b.y = 999; hit = true; break; }
            }
            if (!hit) {
                for (const e of this.enemies) {
                    if (!e.alive || e.state === 'queued' || e.state === 'wait' || e.state === 'beam') continue;
                    if (Math.abs(e.x - sx) < 11 && Math.abs(e.y - p.y) < 11) { this._kill(e); hit = true; break; }
                }
            }
            if (hit) this._hitShip(sx);
        }
        this.bombs = this.bombs.filter((b) => b.y < 900);
    }

    /* ================= the picture ================= */

    /**
     * Draw the playfield on surface s (320 x 240). pause: lines to show in a box over a stopped
     * game (main.js: the car is not parked, no signals), or null.
     */
    draw(s, pause) {
        s.clear(BLACK);
        for (const st of this.stars) if (((this.frame + st.ph) & 63) < 46) s.pset(st.x, st.y, st.c);
        if (this.mode === 'title') this._drawTitle(s);
        else if (this.mode === 'over') this._drawOver(s);
        else this._drawPlay(s);
        this._drawHud(s);
        if (pause && pause.length) this._drawBox(s, pause);
        return s;
    }

    _drawPlay(s) {
        const p = this.player, beat = (this.frame >> 4) & 1;
        // capture beams, under everything
        for (const e of this.enemies) if (e.alive && e.state === 'beam') this._drawBeam(s, e);
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'queued' || e.state === 'wait') continue;
            if (e.captive) { const at = this._heldAt(e); s.blitC(SP.SHIP_HELD_TURNS[SP.turnIndex(e.h + Math.PI / 2)], at.x, at.y); }
            if (e.kind === 'held') { s.blitC(SP.SHIP_HELD_TURNS[SP.turnIndex(e.h + Math.PI / 2)], e.x, e.y); continue; }
            const k = SP.KINDS[e.kind], set = e.kind === 'warden' && e.hp < 2 ? k.hurt : k.frames;
            if (e.state === 'form' || e.state === 'beam') s.blitC(set[beat][0], e.x, e.y);
            else s.blitC(set[0][SP.turnIndex(e.h - DOWN)], e.x, e.y);
        }
        for (const b of this.bombs) s.blitC(SP.BOMB, b.x, b.y);
        for (const b of this.bolts) s.blitC(SP.BOLT, b.x, b.y);
        if (p.state === 'ok') {
            if (!(p.inv > 0 && (this.frame & 4))) {
                if (p.dual) { s.blitC(SP.SHIP, p.x - 8, p.y); s.blitC(SP.SHIP, p.x + 8, p.y); } else s.blitC(SP.SHIP, p.x, p.y);
            }
        } else if (p.state === 'towed') s.blitC(SP.SHIP_TURNS[SP.turnIndex(p.spin)], p.x, p.y);
        if (this.rescue) s.blitC(this.rescue.t < 45 || this.rescue.y < BASE_Y - 70 ? SP.SHIP_TURNS[SP.turnIndex(this.rescue.spin)] : SP.SHIP, this.rescue.x, this.rescue.y);
        for (const b of this.booms) s.blitC(b.frames[Math.min(b.frames.length - 1, Math.floor(b.t / b.rate))], b.x, b.y);
        for (const q of this.popups) s.textC(q.text, q.x, q.y - 4, (q.t & 4) ? C.Y : C.C);

        // what the game says in the middle of the field
        const mid = 128;
        if (this.phase === 'intro') {
            if (this.bonus) s.textC('BONUS RUN', FW / 2, mid, C.C);
            else s.textC('STAGE ' + this.stage, FW / 2, mid, C.C);
            if (this.stage === 1 && this.phaseT > 40) s.textC('READY', FW / 2, mid + 16, C.R);
        } else if (this.phase === 'bonusEnd') {
            if (this.phaseT > 30) s.textC('NUMBER OF HITS  ' + this.stageHits, FW / 2, mid - 16, C.C);
            if (this.phaseT > 90) s.textC('BONUS  ' + this.stageHits * BONUS_HIT, FW / 2, mid, C.Y);
            if (this.phaseT > 130 && this.stageHits === 40) { s.textC('PERFECT!', FW / 2, mid + 20, (this.frame & 8) ? C.R : C.Y); s.textC('SPECIAL BONUS ' + BONUS_PERFECT + ' PTS', FW / 2, mid + 34, C.Y); }
        } else if (this.msg) s.textC(this.msg.text, FW / 2, mid + 30, this.msg.c);      // (under a capture beam's Warden)
        else if (p.state === 'ready') s.textC('READY', FW / 2, mid, C.R);
    }

    _drawBeam(s, e) {
        const out = this._beamOut(e), top = e.y + 8, len = out * (BOTTOM - 2 - top);
        const tints = [C.C, C.W, C.B, C.C, C.D];
        for (let d = 0; d < len; d++) {
            // bands that run down the beam
            const band = Math.floor((d - this.frame * 1.5) / 4);
            if (((band % 2) + 2) % 2) continue;
            const half = Math.round(this._beamHalf(d));
            s.rect(e.x - half, top + d, half * 2 + 1, 1, tints[((band >> 1) % tints.length + tints.length) % tints.length]);
        }
    }

    _drawHud(s) {
        s.rect(0, 0, FW, TOP, BLACK);
        s.text('1UP', 24, 1, C.R);
        s.textR(this.score ? String(this.score) : '00', 72, 9, C.W);
        s.textC('HIGH SCORE', FW / 2, 1, C.R);
        s.textC(this.hiScore ? String(this.hiScore) : '00', FW / 2, 9, C.W);
        if (this.mode === 'title') return;
        s.textR('STAGE', FW - 8, 1, C.R);
        s.textR(String(this.stage), FW - 8, 9, C.W);
        s.rect(0, BOTTOM, FW, FH - BOTTOM, BLACK);
        // ships in reserve
        for (let i = 0; i < Math.min(this.lives, 6); i++) s.blit(SP.SHIP, 2 + i * 17, BOTTOM);
        // stage markers: tens, fives, ones
        let x = FW - 2;
        const marks = [];
        for (let i = 0; i < this.stage % 5; i++) marks.push(SP.MARK1);
        if (this.stage % 10 >= 5) marks.push(SP.MARK5);
        for (let i = 0; i < Math.min(9, Math.floor(this.stage / 10)); i++) marks.push(SP.MARK10);
        for (const m of marks) { x -= m.w + 1; s.blit(m, x, BOTTOM + 2); }
    }

    _drawTitle(s) {
        const stripes = [C.Y, C.Y, C.O, C.O, C.R, C.R, C.M];
        s.textC('SWARM DRIVE', FW / 2 + 2, 32, DIM.map((v) => v >> 1), 3);
        s.textC('SWARM DRIVE', FW / 2, 30, (r) => stripes[r], 3);
        const beat = (this.frame >> 4) & 1, rows = [['dart', '50 - 100'], ['claw', '80 - 160'], ['warden', '150 - 1600']];
        rows.forEach((r, i) => {
            const y = 70 + i * 18;
            s.blitC(SP.KINDS[r[0]].frames[beat][0], 92, y + 3);
            s.text(r[1] + ' PTS', 112, y, C.W);
        });
        s.textC('TURN THE CONTROLLER = MOVE', FW / 2, 128, C.C);
        s.textC('GAS PEDAL = FORWARD', FW / 2, 140, C.C);
        s.textC(this.autoFire ? 'THE GUNS FIRE BY THEMSELVES' : 'PRESS THE CONTROLLER = FIRE', FW / 2, 152, C.C);
        if (this.notice && this.notice.length) {
            this.notice.forEach((line, i) => s.textC(line, FW / 2, 170 + i * 11, i ? C.O : C.R));
        } else {
            if ((this.frame & 63) < 44) s.textC('PRESS THE CONTROLLER TO START', FW / 2, 170, C.Y);
            if (this.hint) s.textC(this.hint, FW / 2, 182, C.O);
        }
        s.blitC(SP.SHIP, FW / 2 + this.ctl.x * (FW / 2 - 12), BASE_Y - this.ctl.y * TRAVEL);
        s.textC('ONLY WHILE PARKED - GEAR IN P', FW / 2, 228, DIM);
    }

    _drawOver(s) {
        const ratio = this.shots ? Math.min(100, this.hits * 100 / this.shots) : 0;
        s.textC('GAME OVER', FW / 2, 70, C.R, 2);
        s.textC('- RESULTS -', FW / 2, 104, C.R);
        s.text('SHOTS FIRED', 72, 122, C.Y); s.textR(String(this.shots), 248, 122, C.Y);
        s.text('NUMBER OF HITS', 72, 136, C.Y); s.textR(String(this.hits), 248, 136, C.Y);
        s.text('HIT RATIO', 72, 150, C.W); s.textR(ratio.toFixed(1) + ' %', 248, 150, C.W);
        if (this.t > 150 && (this.frame & 63) < 44) s.textC('PRESS THE CONTROLLER TO PLAY AGAIN', FW / 2, 182, C.Y);
    }

    _drawBox(s, lines) {
        const w = Math.max.apply(null, lines.map((l) => l.length)) * 8 + 16, h = lines.length * 12 + 12;
        const x = Math.round((FW - w) / 2), y = Math.round((FH - h) / 2);
        s.rect(x, y, w, h, [10, 12, 40]);
        s.frame(x, y, w, h, C.C);
        lines.forEach((l, i) => s.textC(l, FW / 2, y + 8 + i * 12, i ? C.W : C.Y));
    }
}

module.exports = { Game, FW, FH, BASE_Y, TRAVEL, tune, swarmWaves, bonusWaves };
