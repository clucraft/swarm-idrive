'use strict';
/**
 * Tests of the game, its controls and the app's wiring. No car, no browser and no kit are needed:
 *
 *   node test/run.js                      on this computer's Node
 *   node tools/node8.js test/run.js       on Node 8, as the head unit runs the app
 *
 * - the art and the font: every sprite well formed, every text the game shows drawable
 * - controls.js: the controller's clicks and press, the pedal, the selector, the parked check
 * - game.js: a robot plays whole games; the fire button; capture and rescue; the same seed and
 *   inputs give the same game
 * - main.js on a stand-in head unit: signals in, pictures out, and the game stopped when the car
 *   is not in P
 * - the repository: app.json and mgu-repo.json agree, kit/ matches the kit submodule (if checked out)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APPS = path.join(ROOT, 'apps');
const APP_ID = fs.readdirSync(APPS).filter((d) => fs.existsSync(path.join(APPS, d, 'app.json')))[0];
const APP = path.join(APPS, APP_ID);
const req = (f) => require(path.join(APP, f));

const { Surface, glyphOf, textWidth } = req('gfx');
const SP = req('sprites');
const P = req('paths');
const { Game, FW, FH, BASE_Y, TRAVEL, swarmWaves, bonusWaves } = req('game');
const { Controls } = req('controls');
const { Panel, drawHelp, drawGauges, PW, PH } = req('panels');

let failed = 0, ran = 0;
function test(name, fn) {
    ran++;
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
}
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), (what || '') + ' ' + a + ' is not ' + b);

/* ---------------- helpers ---------------- */

// the controller's message as the car sends it
const knob = (count, pressed) => ({ frontRotaryEncoderOperation: count & 0xffff, frontRotaryEncoderPushButton: pressed ? 'DREHGEBER_KURZ_GEDRUECKT' : 'KEINE_BETAETIGUNG', frontRotaryEncoderDeflection: 'MITTELSTELLUNG' });
const pedal = (pct) => ({ actualValueAngleAcceleratorPedal: Math.round(pct / 0.025) });
const inP = { statusActualGearDrive: 'N_OR_P', statusActualStageDrive: 'P' };
const inD = { statusActualGearDrive: 'G1', statusActualStageDrive: 'D' };

/** a robot at the controls: under the nearest of the swarm, out of the way of what falls */
function robot(g) {
    const p = g.player;
    let tx = FW / 2, best = 1e9;
    for (const e of g.enemies) { if (!e.alive || e.state === 'queued' || e.state === 'wait') continue; const d = Math.abs(e.x - p.x) - e.y * 0.3; if (d < best) { best = d; tx = e.x; } }
    for (const b of g.bombs) if (b.y < p.y && p.y - b.y < 60 && Math.abs(b.x - tx) < 12) tx += b.x < tx ? 22 : -22;
    for (const e of g.enemies) if (e.alive && e.y > 130 && e.y < p.y + 10 && Math.abs(e.x - tx) < 18) tx += e.x < tx ? 26 : -26;
    return (tx - FW / 2) / (FW / 2 - 12);
}
/** play until the game is over (or frames run out); returns what happened */
function play(opts, frames, each) {
    const g = new Game(opts), seen = { stages: 0, full: false, twoShots: true, log: [] };
    g.press();
    for (let f = 0; f < frames && g.mode !== 'over'; f++) {
        if (g.mode === 'play') {
            g.setControl(robot(g), (f % 400) < 200 ? 0.4 : 0, true);
            if (each) each(g, f);
        }
        g.step();
        seen.stages = Math.max(seen.stages, g.stage);
        if (g.mode === 'play' && !g.bonus && g.enemies.filter((e) => e.alive && e.state === 'form').length === 40) seen.full = true;
        if (g._volleys() > 2) seen.twoShots = false;
    }
    seen.game = g;
    return seen;
}

/* ---------------- the art ---------------- */

test('sprites: sizes, palettes, sixteen turned copies each', () => {
    [SP.SHIP, SP.SHIP_HELD].concat(SP.DART, SP.CLAW, SP.WARDEN, SP.WARDEN_HURT).forEach((s) => {
        assert.strictEqual(s.w, 16); assert.strictEqual(s.h, 16); assert.strictEqual(s.idx.length, 256);
        assert.ok(s.idx.some((v) => v > 0), 'empty sprite');
        s.idx.forEach((v) => assert.ok(v <= s.pal.length));
    });
    Object.keys(SP.KINDS).forEach((k) => SP.KINDS[k].frames.forEach((set) => assert.strictEqual(set.length, 16)));
    assert.strictEqual(SP.SHIP_TURNS.length, 16);
    assert.strictEqual(SP.BOOM.length, 5); assert.strictEqual(SP.BOOM_SHIP.length, 8);
    // a quarter turn four times is the picture again
    assert.strictEqual(SP.turnIndex(0), 0); assert.strictEqual(SP.turnIndex(Math.PI / 2), 4); assert.strictEqual(SP.turnIndex(-Math.PI / 2), 12);
    // the two ships face opposite ways: the swarm nose down, the player nose up
    const rows = (s) => { const out = []; for (let y = 0; y < 16; y++) { let n = 0; for (let x = 0; x < 16; x++) if (s.idx[y * 16 + x]) n++; out.push(n); } return out; };
    assert.ok(rows(SP.SHIP)[0] < rows(SP.SHIP)[11], 'the ship is nose up');
    assert.ok(rows(SP.DART[0])[14] < rows(SP.DART[0])[3], 'a Dart is nose down');
});

test('font: every text the game and the panels show can be drawn', () => {
    const src = ['game.js', 'panels.js', 'controls.js', 'main.js'].map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
    const texts = [];
    src.replace(/'([^'\n]*)'/g, (m, t) => { if (/^[A-Z0-9 !?:%\/.,=()<>+*^-]{3,}$/.test(t) && /[A-Z]{2}/.test(t)) texts.push(t); return m; });
    assert.ok(texts.length > 40, 'found the texts (' + texts.length + ')');
    texts.concat(['0123456789', 'x']).forEach((t) => t.split('').forEach((ch) => assert.ok(glyphOf(ch), 'no glyph for "' + ch + '" in "' + t + '"')));
    // nothing in the playfield is wider than it
    texts.forEach((t) => { if (src.indexOf("'" + t + "', FW / 2") >= 0) assert.ok(textWidth(t) <= FW - 8, '"' + t + '" is ' + textWidth(t) + ' px wide'); });
    assert.strictEqual(textWidth('AB'), 15);
    assert.strictEqual(textWidth('AB', 3), 45);
});

test('surface: drawing clips at the edges', () => {
    const s = new Surface(20, 10);
    s.rect(-5, -5, 100, 100, [1, 2, 3]); s.blit(SP.SHIP, 12, -8); s.blit(SP.SHIP, -10, 4); s.text('WWW', 4, 6, [9, 9, 9], 2); s.pset(-1, 99, [1, 1, 1]);
    assert.strictEqual(s.data.length, 20 * 10 * 4);
    for (let i = 3; i < s.data.length; i += 4) assert.strictEqual(s.data[i], 255);
});

test('routes: every route is flown out, and the ones into the formation end inside the field', () => {
    Object.keys(P.ROUTES).forEach((name) => {
        [false, true].forEach((mirrored) => {
            const e = {};
            P.begin(e, P.ROUTES[name], mirrored, FW);
            let steps = 0;
            while (P.advance(e, 2.8) && steps < 2000) steps++;
            assert.ok(steps < 2000, name + ' ends');
            assert.ok(isFinite(e.x) && isFinite(e.y) && isFinite(e.h), name + ' stays finite');
            if (!/^run/.test(name)) assert.ok(e.x > 0 && e.x < FW && e.y > 0 && e.y < 200, name + ' ends in the field: ' + e.x.toFixed(0) + ', ' + e.y.toFixed(0));
        });
        // mirrored is the same route from the other side
        const a = {}, b = {};
        P.begin(a, P.ROUTES[name], false, FW); P.begin(b, P.ROUTES[name], true, FW);
        for (let i = 0; i < 40; i++) { P.advance(a, 3); P.advance(b, 3); near(a.x, FW - b.x, 1e-6, name); near(a.y, b.y, 1e-6, name); }
    });
});

test('stages: forty in every swarm, each place taken once; bonus runs every fourth stage from the third', () => {
    [1, 2, 3, 4, 5, 9].forEach((n) => {
        const all = [].concat.apply([], swarmWaves(n));
        assert.strictEqual(all.length, 40);
        const places = {};
        all.forEach((e) => { const k = e.col + ',' + e.row; assert.ok(!places[k], 'place ' + k + ' twice'); places[k] = e.kind; });
        assert.strictEqual(all.filter((e) => e.kind === 'warden').length, 4);
        assert.strictEqual(all.filter((e) => e.kind === 'claw').length, 16);
        assert.strictEqual(all.filter((e) => e.kind === 'dart').length, 20);
        all.forEach((e) => assert.ok(P.ROUTES[e.route], 'route ' + e.route));
    });
    assert.strictEqual([].concat.apply([], bonusWaves(3)).length, 40);
    const g = new Game({ seed: 1 });
    g.newGame();
    const bonus = [];
    for (let n = 1; n <= 12; n++) { g._beginStage(n); if (g.bonus) bonus.push(n); }
    assert.deepStrictEqual(bonus, [3, 7, 11]);
});

/* ---------------- the controls ---------------- */

test('controller: a click moves the ship a step, only while the game runs; the counter wraps; a reset is no turn', () => {
    const c = new Controls({ half: 148 });
    c.configure({ step: 12 });
    c.onKnob(knob(65534, false));                         // where the knob stands
    assert.strictEqual(c.read().x, 0);
    assert.strictEqual(c.onKnob(knob(65535, false)).turned, 0, 'not active: no move');
    c.setActive(true);
    assert.strictEqual(c.onKnob(knob(1, false)).turned, 2, 'two clicks across the wrap');
    near(c.read().x, 2 * 12 / 148, 1e-9);
    c.onKnob(knob(0, false));
    near(c.read().x, 12 / 148, 1e-9, 'a click back');
    c.onKnob(knob(30000, false));                         // a jump: the counter was reset
    near(c.read().x, 12 / 148, 1e-9, 'a jump is no turn');
    for (let i = 1; i <= 60; i++) c.onKnob(knob(30000 + i, false));
    assert.strictEqual(c.read().x, 1, 'stops at the edge');
    c.recentre();
    assert.strictEqual(c.read().x, 0);
    c.configure({ step: 24, reversed: true });
    c.onKnob(knob(30061, false));
    near(c.read().x, -24 / 148, 1e-9, 'reversed, a bigger step');
});

test('controller: the press, by name and by number; a head unit without a controller is ignored', () => {
    const c = new Controls({});
    assert.strictEqual(c.onKnob({ frontRotaryEncoderOperation: 65535, frontRotaryEncoderPushButton: 'SIGNAL_UNGUELTIG', frontRotaryEncoderDeflection: 'SIGNAL_UNGUELTIG' }).press, false);
    assert.strictEqual(c.knobLive, false);
    assert.strictEqual(c.onKnob(knob(5, true)).press, true);
    assert.strictEqual(c.fire, true); assert.strictEqual(c.knobLive, true);
    assert.strictEqual(c.onKnob(knob(5, true)).press, false, 'still down');
    assert.strictEqual(c.onKnob({ frontRotaryEncoderOperation: 5, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0 }).press, true);
    assert.strictEqual(c.fire, false);
    assert.strictEqual(c.onKnob({ frontRotaryEncoderOperation: 5, frontRotaryEncoderPushButton: 2, frontRotaryEncoderDeflection: 0 }).press, true, 'a long press');
    assert.strictEqual(c.fire, true);
    assert.strictEqual(c.onKnob(null).press, false);
});

test('pedal: released is the back row; the chosen part of its travel is all the way forward', () => {
    const c = new Controls({});
    assert.strictEqual(c.read().y, 0); assert.strictEqual(c.read().pedalLive, false); assert.strictEqual(c.pedal(), null);
    c.configure({ travel: 50 });
    c.onPedal(pedal(4));                                  // this pedal rests at 4 %
    assert.strictEqual(c.read().y, 0); assert.strictEqual(c.read().pedalLive, true);
    c.onPedal(pedal(5)); assert.strictEqual(c.read().y, 0, 'inside the dead zone');
    c.onPedal(pedal(30)); near(c.read().y, (26 - 2) / 48, 1e-6);
    c.onPedal(pedal(54)); assert.strictEqual(c.read().y, 1);
    c.onPedal(pedal(100)); assert.strictEqual(c.read().y, 1);
    c.onPedal(pedal(4)); assert.strictEqual(c.read().y, 0, 'let off: back');
    c.configure({ travel: 25 }); c.onPedal(pedal(16.5)); near(c.read().y, 10.5 / 23, 1e-6);
    c.onPedal({ actualValueAngleAcceleratorPedal: 65535 }); near(c.read().y, 10.5 / 23, 1e-6, '"no value" is skipped');
    // a struct with another member name for the angle is still read; one without any is not
    const d = new Controls({});
    d.onPedal({ angleAcceleratorPedal: 800, crcAngle: 77 }); near(d.pct, 20, 1e-9);
    const e = new Controls({});
    e.onPedal({ something: 5 }); assert.strictEqual(e.pct, null);
});

test('parked: only with the selector in P and the car standing', () => {
    const fresh = () => new Controls({});
    let c = fresh();
    assert.strictEqual(c.park(false, false).ok, true, 'no car at all: the emulator, a bench');
    assert.strictEqual(c.park(false, false).noCar, true);
    assert.strictEqual(c.park(false, true).ok, false, 'a car that sends speed but no selector');
    c.onPedal(pedal(0));
    assert.strictEqual(c.park(false, false).ok, false, 'a car that sends the pedal but no selector');
    c.onGearbox(inP);
    assert.strictEqual(c.park(false, true).ok, true); assert.strictEqual(c.selector(), 'P');
    assert.strictEqual(c.park(true, true).ok, false, 'moving');
    c.onGearbox(inD);
    assert.strictEqual(c.park(false, true).ok, false); assert.strictEqual(c.selector(), 'D');
    assert.ok(/SHIFT TO P/.test(c.park(false, true).why[0]));
    c.onGearbox({ statusActualGearDrive: 'R', statusActualStageDrive: 'R' }); assert.strictEqual(c.park(false, true).ok, false);
    c.onGearbox({ statusActualGearDrive: 'N_OR_P', statusActualStageDrive: 'N' }); assert.strictEqual(c.park(false, true).ok, false, 'N is not parked');
    // the other signal, names and wire numbers
    c = fresh(); c.onSelection({ statusGearSelectionDrive: 'P' }); assert.strictEqual(c.park(false, true).ok, true);
    c = fresh(); c.onSelection({ statusGearSelectionDrive: 3 }); assert.strictEqual(c.selector(), 'P');
    c = fresh(); c.onSelection({ statusGearSelectionDrive: '_3' }); assert.strictEqual(c.selector(), 'D');
    c = fresh(); c.onSelection({ statusGearSelectionDrive: 7 }); assert.strictEqual(c.park(false, true).ok, false);
    c = fresh(); c.onSelection({ statusGearSelectionDrive: 2 }); assert.strictEqual(c.selector(), 'R');
    c = fresh(); c.onSelection({ statusGearSelectionDrive: 4 }); assert.strictEqual(c.selector(), 'NP');
    assert.strictEqual(c.park(false, true).ok, true, 'N or P, not told apart: no drive gear');
    c = fresh(); c.onGearbox({ statusActualGearDrive: 2 }); assert.strictEqual(c.selector(), 'NP');
    c = fresh(); c.onGearbox({ statusActualGearDrive: 5, statusActualStageDrive: 4 }); assert.strictEqual(c.selector(), 'D');
    // the two signals disagree: a drive gear on either one counts
    c = fresh(); c.onGearbox(inP); c.onSelection({ statusGearSelectionDrive: '_1' });
    assert.strictEqual(c.selector(), 'D'); assert.strictEqual(c.park(false, true).ok, false);
    c = fresh(); c.onGearbox(inD); c.onSelection({ statusGearSelectionDrive: 'P' }); assert.strictEqual(c.park(false, true).ok, false);
    // every reason fits its place on the screen
    [fresh().park(true, true), (() => { const x = fresh(); x.onGearbox(inD); return x.park(false, true); })(), fresh().park(false, true)].forEach((r) => {
        assert.strictEqual(r.why.length, 2);
        r.why.forEach((l) => assert.ok(l.length <= 38, l));
    });
});

/* ---------------- the game ---------------- */

test('game: waits on the title for a press; the pedal alone starts nothing', () => {
    const g = new Game({ seed: 3 });
    for (let i = 0; i < 200; i++) { g.setControl(0.5, i % 50 < 25 ? 1 : 0, true); g.step(); }
    assert.strictEqual(g.mode, 'title');
    g.press(); g.step();
    assert.strictEqual(g.mode, 'play'); assert.strictEqual(g.stage, 1); assert.strictEqual(g.lives, 2);
    assert.deepStrictEqual(g.events.map((e) => e.type), ['start', 'stage']);
});

test('game: the controls move the ship - x across the field, the pedal forward and back', () => {
    const g = new Game({ seed: 3 });
    g.newGame();
    const run = (x, y, n) => { for (let i = 0; i < n; i++) { g.setControl(x, y, true); g.step(); } };
    run(0, 0, 60); near(g.player.x, FW / 2, 0.01); near(g.player.y, BASE_Y, 0.01);
    run(-1, 0, 60); near(g.player.x, 12, 0.01, 'far left');
    run(1, 0, 10); assert.ok(g.player.x > 12 && g.player.x < 100, 'it flies there, it does not jump');
    run(1, 0, 60); near(g.player.x, FW - 12, 0.01, 'far right');
    run(0, 1, 60); near(g.player.y, BASE_Y - TRAVEL, 0.01, 'pedal down: forward');
    run(0, 0.5, 60); near(g.player.y, BASE_Y - TRAVEL / 2, 0.01);
    run(0, 0, 60); near(g.player.y, BASE_Y, 0.01, 'let off: back');
});

test('game: a robot plays whole games; the formation fills; never more than two shots in the air', () => {
    let best = 0;
    [1, 2, 4, 5].forEach((seed) => {
        const r = play({ seed, ships: 5 }, 30000);
        const g = r.game;
        assert.strictEqual(g.mode, 'over', 'seed ' + seed + ' ends');
        assert.ok(r.stages >= 2, 'seed ' + seed + ' reached stage ' + r.stages);
        assert.ok(r.twoShots, 'two shots at most');
        assert.ok(g.score > 3000 && g.hits > 40 && g.shots >= g.hits, 'seed ' + seed + ': ' + g.score + ' points');
        assert.strictEqual(g.hiScore, g.score);
        best = Math.max(best, r.stages);
    });
    assert.ok(best >= 4, 'a bonus run was played (stage ' + best + ')');
    // left alone the swarm takes up its whole formation
    const idle = new Game({ seed: 9, autoFire: false });
    idle.newGame();
    let full = false;
    for (let f = 0; f < 1400 && !full; f++) { idle.setControl(-1, 0, true); idle.step(); full = idle.enemies.filter((e) => e.alive && e.state === 'form').length === 40; }
    assert.ok(full, 'all forty in formation');
    assert.strictEqual(idle.phase, 'attack');
});

test('game: the same seed and the same inputs are the same game', () => {
    const a = play({ seed: 77, ships: 3 }, 9000).game, b = play({ seed: 77, ships: 3 }, 9000).game, c = play({ seed: 78, ships: 3 }, 9000).game;
    assert.strictEqual(a.score, b.score); assert.strictEqual(a.frame, b.frame); assert.strictEqual(a.shots, b.shots);
    assert.ok(a.score !== c.score || a.frame !== c.frame, 'another seed, another game');
});

test('guns: on the fire button nothing fires by itself; a press is a shot, held is rapid fire; automatic needs no button', () => {
    const start = (autoFire) => { const g = new Game({ seed: 5, autoFire }); g.newGame(); for (let i = 0; i < 130; i++) { g.setControl(0, 0, true); g.step(); } assert.strictEqual(g.phase, 'entry'); return g; };
    let g = start(false);
    for (let i = 0; i < 100; i++) g.step();
    assert.strictEqual(g.shots, 0, 'no press, no shot');
    g.setFire(true); g.step(); g.setFire(false);
    assert.strictEqual(g.shots, 1, 'one press, one shot');
    for (let i = 0; i < 60; i++) g.step();
    assert.strictEqual(g.shots, 1);
    g.setFire(true);
    for (let i = 0; i < 120; i++) g.step();
    g.setFire(false);
    assert.ok(g.shots >= 5 && g.shots <= 10, 'held: rapid fire (' + g.shots + ')');
    const n = g.shots;
    g.trigger(); g.step(); g.step();
    assert.ok(g.shots === n + 1 || g._volleys() === 2, 'a tapped button is a shot');
    g = start(true);
    for (let i = 0; i < 100; i++) g.step();
    assert.ok(g.shots >= 4, 'automatic fire (' + g.shots + ')');
    // on the title and the results the fire button starts a game
    const t = new Game({ seed: 5, autoFire: false });
    t.setFire(true); t.step();
    assert.strictEqual(t.mode, 'play');
});

test('capture and rescue: the beam takes the ship; shooting its captor in flight brings it back as a second ship', () => {
    const g = new Game({ seed: 11, ships: 3, autoFire: false });
    g.newGame();
    for (let f = 0; f < 1500 && g.phase !== 'attack'; f++) { g.setControl(-1, 0, true); g.step(); }
    assert.strictEqual(g.phase, 'attack');
    g.launchT = 1e9;                                    // nobody else leaves the formation
    g.enemies.forEach((e) => { if (e.alive && FLYING(e)) g._wrap(e); });
    g.bombs = [];
    const w = g.enemies.filter((e) => e.alive && e.kind === 'warden' && e.state === 'form')[0];
    assert.ok(w, 'a Warden in the formation');
    g.setControl(0, 0, true);
    for (let i = 0; i < 80; i++) g.step();             // the ship to the middle
    g.player.inv = 0;
    g._launch(w, 'beam', 0);
    const lives = g.lives;
    let captured = false;
    for (let f = 0; f < 900 && !captured; f++) { g.setControl((w.bx - FW / 2) / (FW / 2 - 12), 0, true); g.step(); captured = w.captive; }
    assert.ok(captured, 'the ship was captured');
    assert.strictEqual(g.lives, lives - 1);
    assert.ok(g.player.state !== 'ok');
    for (let f = 0; f < 900 && !(w.state === 'form' && g.player.state === 'ok'); f++) g.step();
    assert.strictEqual(w.state, 'form'); assert.strictEqual(g.player.state, 'ok');
    // its captor dives; the player shoots it in flight
    g._launch(w, 'dive', 0);
    w.hp = 1;
    const score = g.score;
    let freed = false;
    for (let f = 0; f < 900 && !freed; f++) {
        g.setControl((w.x - FW / 2) / (FW / 2 - 12), 0, true);
        g.setFire(w.state === 'dive' && w.y > 60 && w.y < 150);
        g.player.inv = 5;                               // (this test is about the rescue, not about dodging)
        g.step();
        freed = !!g.rescue || g.player.dual;
    }
    g.setFire(false);
    assert.ok(freed, 'the ship was freed');
    assert.ok(g.score >= score + 1000 + 400, 'rescue points');
    for (let f = 0; f < 600 && !g.player.dual; f++) { g.player.inv = 5; g.step(); }
    assert.strictEqual(g.player.dual, true, 'two ships side by side');
    // two ships fire two shots at once
    const shots = g.shots;
    g.setFire(true); g.player.cool = 0; g.bolts = []; g.step(); g.setFire(false);
    assert.strictEqual(g.shots, shots + 2);
    // one of the two is hit: the other flies on, no ship is lost
    const left = g.lives;
    g.player.inv = 0;
    g._hitShip(g.player.x - 8);
    assert.strictEqual(g.player.dual, false); assert.strictEqual(g.lives, left); assert.strictEqual(g.player.state, 'ok');
});
function FLYING(e) { return ['launch', 'dive', 'loop', 'toBeam', 'beam'].indexOf(e.state) >= 0; }

test('capture: a captor shot in the formation sends the ship against the player; out of ships is the end', () => {
    const g = new Game({ seed: 12, ships: 1, autoFire: false });
    g.newGame();
    assert.strictEqual(g.lives, 0);
    for (let f = 0; f < 1500 && g.phase !== 'attack'; f++) { g.setControl(-1, 0, true); g.step(); }
    const w = g.enemies.filter((e) => e.alive && e.kind === 'warden' && e.state === 'form')[0];
    w.captive = true;
    w.hp = 1;
    g._kill(w);
    const held = g.enemies.filter((e) => e.alive && e.kind === 'held');
    assert.strictEqual(held.length, 1, 'the held ship flies against the player');
    assert.strictEqual(g.rescue, null);
    g.launchT = 1e9;
    for (let f = 0; f < 600 && held[0].alive; f++) { g.player.inv = 5; g.step(); }
    assert.strictEqual(held[0].alive, false, 'and leaves at the bottom');
    // the last ship is lost
    g.player.inv = 0;
    g._hitShip(g.player.x);
    for (let f = 0; f < 400 && g.mode !== 'over'; f++) g.step();
    assert.strictEqual(g.mode, 'over');
    assert.deepStrictEqual(g.events.filter((e) => e.type === 'over').length, 1);
    g.press();
    for (let f = 0; f < 160; f++) g.step();
    assert.strictEqual(g.mode, 'over', 'the results stay a moment, whatever is pressed');
    g.press(); g.step();
    assert.strictEqual(g.mode, 'play', 'then a press plays again');
});

test('extra ships at 20 000 and 70 000 points', () => {
    const g = new Game({ seed: 1 });
    g.newGame();
    const lives = g.lives;
    g._add(19990); assert.strictEqual(g.lives, lives);
    g._add(10); assert.strictEqual(g.lives, lives + 1);
    g._add(49990); assert.strictEqual(g.lives, lives + 1);
    g._add(10); assert.strictEqual(g.lives, lives + 2);
});

test('pictures: the title, a game, a pause box and the results draw into 320 x 240; the panels into 160 x 240', () => {
    const s = new Surface(FW, FH);
    const lit = () => { let n = 0; for (let i = 0; i < s.data.length; i += 4) if (s.data[i] || s.data[i + 1] || s.data[i + 2]) n++; return n; };
    const g = new Game({ seed: 2 });
    g.notice = ['SHIFT TO P TO PLAY', 'THE SELECTOR IS IN D']; g.hint = 'NO PEDAL DATA YET - IGNITION ON?';
    g.draw(s, null);
    const title = lit();
    assert.ok(title > 3000, 'the title screen (' + title + ' pixels lit)');
    g.newGame();
    for (let f = 0; f < 700; f++) { g.setControl(robot(g), 0, true); g.step(); if (f % 50 === 0) g.draw(s, null); }
    g.draw(s, null);
    const game = lit();
    g.draw(s, ['PAUSED', 'SHIFT TO P TO PLAY', 'THE SELECTOR IS IN D']);
    assert.ok(lit() > game + 2000, 'the pause box');
    g._over(); g.draw(s, null);
    assert.ok(lit() > 2000, 'the results');
    const p = new Panel();
    assert.strictEqual(p.update('a', (x) => drawHelp(x, { autoFire: false })), true);
    assert.strictEqual(p.update('a', (x) => drawHelp(x, { autoFire: false })), false, 'unchanged: not drawn again');
    assert.strictEqual(p.s.w, PW); assert.strictEqual(p.s.h, PH);
    const q = new Panel();
    q.update('b', (x) => drawGauges(x, { knob: true, x: -0.4, pedal: 31, y: 0.6, selector: 'P', speed: 0, autoFire: false, fire: true, state: ['PARKED: READY', [1, 2, 3], ''] }));
    q.update('c', (x) => drawGauges(x, { knob: false, x: 0, pedal: null, y: 0, selector: null, speed: null, autoFire: true, fire: false, state: ['NO CAR DATA', [1, 2, 3], ''] }));
});

/* ---------------- main.js on a stand-in head unit ---------------- */

test('app: signals in, pictures out; the controller plays; out of P the game stops', () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-test-'));
    const images = {}, handlers = {}, clicks = {}, texts = {}, focus = [], logs = [];
    let loop = null, ccu = null, grabbed = null, visible = false, shown = 0, impl = null, clock = 1e6, speed = null;
    class FakeRecorder {
        constructor(w, h) { this.w = w; this.h = h; this.ops = []; }
        reset() { this.ops = []; return this; }
        clear() { return this; }
        fillRect() { return this; }
        image(id, x, y, w, h) { this.ops.push({ id, x, y, w, h }); return this; }
        xf() { return this; }
        append(r) { this.ops = this.ops.concat(r.ops); return this; }
    }
    const fakes = {
        './kit/mgu': { run: (i) => { impl = i; } },
        './kit/record': { Recorder: FakeRecorder, setImage: (id, w, h, d) => { images[id] = { w, h, d, n: ((images[id] || {}).n || 0) + 1 }; } },
        './kit/parked': { watch: () => ({ moving: () => speed !== null && speed > 3, speed: () => speed }) },
    };
    const settings = { fire: 'knob', knobStep: '12', knobDir: 'normal', pedalTravel: '50', ships: '3', panels: true };
    let frame = null;
    const ctx = {
        dataDir: data,
        log: { info: (s) => logs.push(String(s)), warn: (s) => logs.push('WARN ' + s), error: (s) => logs.push('ERROR ' + s) },
        settings: { get: (k) => settings[k], onChange: () => {} },
        ui: {
            isVisible: (n) => n === 'GAME' && visible, hasFocus: () => true, onFocus: (fn) => focus.push(fn),
            onClick: (n, fn) => { clicks[n] = fn; }, text: (n, t) => { texts[n] = t; }, open: (n) => { if (n === 'GAME') { visible = true; focus.forEach((fn) => fn()); } },
            image: (n, cv) => { shown++; frame = cv; return Promise.resolve(); },
        },
        signals: { watch: (iface, inst, h) => { handlers[iface] = h; return Promise.resolve({}); } },
        controller: { grab: (on) => { grabbed = on; }, onInput: (fn) => { ccu = fn; } },
        canvas: (w, h) => { const cv = new FakeRecorder(w, h); cv.place = { x: 0, y: 0, w: 1920, h: 720, full: true }; return cv; },
        loop: (n, fps, fn) => { loop = fn; },
    };
    const load = Module._load, now = Date.now, timers = [], setI = global.setInterval;
    Module._load = function (request) { return fakes[request] || load.apply(this, arguments); };
    Date.now = () => clock;
    global.setInterval = (fn) => { timers.push(fn); return 0; };
    const tick = (n) => { for (let i = 0; i < (n || 1); i++) { clock += 1000 / 60; loop(); } };
    try {
        delete require.cache[path.join(APP, 'main.js')];
        require(path.join(APP, 'main.js'));
        impl.start(ctx);
        const sel = handlers['de.bmw.infrastructure.VehicleInformation'], ped = handlers['de.bmw.powertrain.AcceleratorPedal'];
        assert.ok(sel && ped && handlers['de.bmw.infotainment.controlelements.FrontCCU'], 'subscribed to the selector, the pedal and the controller');
        assert.strictEqual(texts.BTN_PLAY, 'Play');

        // in a car, in P: Play opens the game on its title
        speed = 0; sel.statusGearboxDrive(inP); ped.AngleAcceleratorPedal(pedal(0));
        clicks.BTN_PLAY();
        assert.strictEqual(grabbed, true, 'the game holds the controller');
        tick(3);
        assert.ok(images[1] && images[1].w === FW && images[1].h === FH, 'the playfield picture');
        assert.ok(images[2] && images[3] && images[2].w === PW, 'the two panels');
        // 3 x on the 1920 x 720 screen, centred, a panel on either side
        const at = (id) => frame.ops.filter((o) => o.id === id)[0];
        assert.deepStrictEqual(at(1), { id: 1, x: 480, y: 0, w: 960, h: 720 });
        assert.deepStrictEqual(at(2), { id: 2, x: 0, y: 0, w: 480, h: 720 });
        assert.deepStrictEqual(at(3), { id: 3, x: 1440, y: 0, w: 480, h: 720 });

        // a press starts the game; turning moves the ship; the pedal flies it forward
        ccu(knob(100, false)); ccu(knob(100, true)); tick(); ccu(knob(100, false));
        assert.ok(logs.indexOf('game started') >= 0, 'started by the press');
        tick(130);
        const before = images[1].n;
        for (let i = 1; i <= 5; i++) ccu(knob(100 + i, false));
        ped.AngleAcceleratorPedal(pedal(60));
        tick(40);
        assert.ok(images[1].n > before, 'new pictures');
        const field = images[1].d, ship = (x, y) => { const i = (y * FW + x) * 4; return field[i] > 200 && field[i + 1] > 200 && field[i + 2] > 200; };
        assert.ok(ship(FW / 2 + 5 * 12, BASE_Y - TRAVEL - 6) || ship(FW / 2 + 5 * 12 - 1, BASE_Y - TRAVEL - 6), 'the ship is five clicks right of the middle, all the way forward');

        // the selector leaves P: the game stops and says why; turning does nothing; back in P it goes on
        sel.statusGearboxDrive(inD);
        tick(2);
        const stopped = images[1].n;
        for (let i = 6; i <= 9; i++) ccu(knob(100 + i, false));
        tick(30);
        assert.strictEqual(images[1].n, stopped, 'no new pictures while it is not parked');
        sel.statusGearboxDrive(inP);
        tick(5);
        assert.ok(images[1].n > stopped, 'on again in P');
        assert.ok(ship(FW / 2 + 5 * 12, BASE_Y - TRAVEL - 6) || ship(FW / 2 + 5 * 12 - 1, BASE_Y - TRAVEL - 6), 'the turns made out of P moved nothing');

        // driving off stops it too
        speed = 20; tick(2);
        const moving = images[1].n;
        tick(20);
        assert.strictEqual(images[1].n, moving);
        speed = 0;

        // BACK: the game lets go of the controller and waits; the menu offers Continue
        visible = false; timers.forEach((fn) => fn());
        assert.strictEqual(grabbed, false);
        assert.strictEqual(texts.BTN_PLAY, 'Continue');
        assert.ok(!logs.some((l) => /^(WARN|ERROR)/.test(l)), logs.filter((l) => /^(WARN|ERROR)/.test(l)).join('; '));
    } finally {
        Module._load = load; Date.now = now; global.setInterval = setI;
    }
});

/* ---------------- the repository ---------------- */

test('app.json and mgu-repo.json: one app, its id its folder; the settings main.js reads exist', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
    const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-repo.json'), 'utf8'));
    assert.strictEqual(spec.id, APP_ID);
    assert.ok(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(spec.id), 'an id the MGU Store takes');
    assert.ok(/^\d+\.\d+\.\d+$/.test(spec.version));
    assert.ok(/^[A-Z0-9]{4}$/.test(spec.loggingId));
    assert.strictEqual(repo.schema, 1);
    assert.strictEqual(repo.apps.path, 'apps/*'); assert.strictEqual(repo.apps.manifest, 'app.json');
    assert.ok(fs.existsSync(path.join(ROOT, repo.apps.build.python)), 'the build script is in the repository');
    repo.apps.build.shared.filter((p) => p !== repo.apps.build.sdk).forEach((p) => assert.ok(fs.existsSync(path.join(ROOT, p)), p + ' is in the repository'));
    assert.ok(fs.existsSync(path.join(APP, repo.apps.icon)), 'the icon');
    const main = fs.readFileSync(path.join(APP, 'main.js'), 'utf8'), keys = spec.settings.map((s) => s.key);
    const read = [];
    main.replace(/settings\.get\('([a-zA-Z]+)'\)/g, (m, k) => { read.push(k); return m; });
    read.forEach((k) => assert.ok(keys.indexOf(k) >= 0, 'setting ' + k));
    keys.forEach((k) => assert.ok(read.indexOf(k) >= 0, 'setting ' + k + ' is used'));
    spec.settings.forEach((s) => { if (s.type === 'choice') assert.ok(s.options.some((o) => o[0] === s.default), s.key + ' default'); });
    // every interface main.js subscribes to is asked for in app.json (the installer makes only those reachable)
    main.replace(/signals\.watch\('([^']+)'/g, (m, i) => { assert.ok(spec.signals[i], i + ' is in app.json'); return m; });
    assert.ok(spec.signals['de.bmw.infotainment.vehicle.Vehicle2'].statusCarSpeed2, 'the speed, for kit/parked.js');
    // there is no setting to play while driving
    assert.ok(keys.indexOf('parkedOnly') < 0);
    // the game's code runs on Node 8: none of the newer syntax
    fs.readdirSync(APP).filter((f) => f.endsWith('.js')).forEach((f) => {
        const src = fs.readFileSync(path.join(APP, f), 'utf8');
        assert.ok(!/\?\.[a-zA-Z_(\[]|\?\?|catch\s*\{|\.flat\(|\.flatMap\(|\bBigInt\b|\.matchAll\(|\.replaceAll\(|Object\.fromEntries|\.at\(-?\d/.test(src), f + ' uses syntax newer than Node 8');
    });
});

test('kit/: the copy the MGU Store builds with matches the kit submodule', () => {
    const stamp = JSON.parse(fs.readFileSync(path.join(ROOT, 'kit', 'UPSTREAM.json'), 'utf8'));
    assert.ok(/^[0-9a-f]{40}$/.test(stamp.commit));
    ['kit/runtime/mgu.js', 'kit/runtime/record.js', 'kit/runtime/parked.js', 'kit/platform/permissions.json', 'kit/tools/build.py', 'kit/tools/oapgen/gen.js', 'kit/LICENSE']
        .forEach((p) => assert.ok(fs.existsSync(path.join(ROOT, p)), p));
    if (!fs.existsSync(path.join(ROOT, 'vendor', 'idrive7-apps', 'kit', 'tools', 'build.py'))) { console.log('     (the submodule is not checked out: not compared)'); return; }
    // (run on this computer's Node: the tools are not for Node 8)
    const node = process.env.npm_node_execpath || (Number(process.versions.node.split('.')[0]) >= 12 ? process.execPath : 'node');
    const r = spawnSync(node, [path.join(ROOT, 'tools', 'sync-kit.js'), '--check'], { cwd: ROOT });
    assert.strictEqual(r.status, 0, String(r.stdout) + String(r.stderr));
});

console.log('\n' + (ran - failed) + ' of ' + ran + ' passed' + (failed ? ', ' + failed + ' FAILED' : '') + ' (Node ' + process.versions.node + ')');
process.exit(failed ? 1 : 0);
