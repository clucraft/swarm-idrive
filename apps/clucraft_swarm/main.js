'use strict';
/**
 * Swarm Drive - an 8-bit arcade shooter on the iDrive, played with the car's own controls while it
 * is parked:
 *
 *   iDrive controller   turn: the ship moves left and right, a step per click
 *                       press: fire, hold for rapid fire (or the guns fire by themselves: a setting)
 *   accelerator pedal   flies the ship forward; let off and it comes back
 *   BACK                the menu; the game waits there
 *
 * The game runs only with the selector in P and the car standing (controls.js): the pedal is one of
 * its controls, so there is no setting to play while driving.
 *
 * Screens:
 *   MAIN  the main menu, an HMI list: Play / Continue, New game, every setting.
 *   GAME  the game alone on the whole screen ("chrome": false): the 320 x 240 playfield in the
 *         middle, as many whole times bigger as fits (3 x on the 1920 x 720 display), a panel with
 *         the controls on either side.
 *
 * game.js is the game (it knows nothing about the car), gfx.js the pixel framebuffer it draws in,
 * sprites.js the art, paths.js the flight routes, panels.js the side panels. The playfield goes to
 * the kit's GPU renderer as one pixel image a frame, as the kit's Doom does.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { Recorder, setImage } = require('./kit/record');
const Parked = require('./kit/parked');
const { Game, FW, FH } = require('./game');
const { Surface } = require('./gfx');
const { Controls } = require('./controls');
const { Panel, drawHelp, drawGauges, PW } = require('./panels');
const { C } = require('./sprites');

const W = 1600, H = 520;
const FIELD = 1, LEFT = 2, RIGHT = 3;       // the pixel images
const FRAME_MS = 1000 / 60;
const RESUME_MS = 1500;                     // coming back to a running game: this long to get the hands in place
// the right panel's two short lines for why the game waits (controls.js park().why[0])
const PANEL_WHY = {
    'THE CAR IS MOVING': ['CAR IS MOVING', C.R, 'GAME WAITS'],
    'SHIFT TO P TO PLAY': ['NOT IN P', C.R, 'SHIFT TO P'],
    'WAITING FOR THE GEAR SELECTOR': ['SELECTOR UNKNOWN', C.R, 'NEEDS P'],
};

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;

        /* ---------- the game ---------- */
        const scoreFile = path.join(ctx.dataDir, 'highscore.json');
        let hi = 0;
        try { hi = Number(JSON.parse(fs.readFileSync(scoreFile, 'utf8')).hi) || 0; } catch (e) { /* none yet */ }
        const game = new Game({ seed: Date.now() & 0x7fffffff, hiScore: hi });
        const saveHi = () => {
            if (game.hiScore <= hi) return;
            hi = game.hiScore;
            try { fs.writeFileSync(scoreFile, JSON.stringify({ hi })); } catch (e) { log.warn('high score: ' + e); }
        };

        /* ---------- the car as the controller ---------- */
        const ctl = new Controls({ log, half: FW / 2 - 12 });
        const parked = Parked.watch(ctx, log);          // the car's speed
        const said = (what) => (s) => log.info(what + ' ' + (s.error ? 'error: ' + s.error : 'subscribed'));
        ctx.signals.watch('de.bmw.powertrain.AcceleratorPedal', '1', { AngleAcceleratorPedal: (v) => ctl.onPedal(v) }, log).then(said('pedal'));
        ctx.signals.watch('de.bmw.infrastructure.VehicleInformation', '1', {
            statusGearboxDrive: (v) => ctl.onGearbox(v),
            DataPowerTrain2: (v) => ctl.onSelection(v),
        }, log).then(said('selector'));
        // the iDrive controller: from the renderer while the game holds it (the HMI doesn't get it
        // then), else the app's own copy from the car
        let knobT = 0;
        const knob = (v) => { if (ctl.onKnob(v).press) fireButton(ctl.fire); };
        if (ctx.controller && ctx.controller.onInput) ctx.controller.onInput((v) => { knobT = Date.now(); knob(v); });
        ctx.signals.watch('de.bmw.infotainment.controlelements.FrontCCU', '1', {
            statusRotaryEncoderState: (v) => { if (Date.now() - knobT > 1000) knob(v); },
        }, log).then(said('controller'));

        function applySettings() {
            ctl.configure({
                step: Number(settings.get('knobStep')) || 12,
                travel: Number(settings.get('pedalTravel')) || 50,
                reversed: settings.get('knobDir') === 'reversed',
            });
            game.autoFire = settings.get('fire') === 'auto';
            game.ships = Number(settings.get('ships')) || 3;
        }
        applySettings();
        settings.onChange(() => { applySettings(); menu(); });

        /* ---------- is the game on, may it run ---------- */
        const shown = () => ui.isVisible('GAME') && (!ui.hasFocus || ui.hasFocus('GAME'));
        const park = () => ctl.park(parked.moving(), parked.speed() !== null);
        let going = false, holdUntil = 0;
        let last = 0, acc = 0, stepped = 0, lastPause = '';      // the frame clock (advance)

        // the fire button: the controller's press, and the HMI's own (hidden) bar button under the
        // picture, which it presses when the app doesn't hold the controller
        function fireButton(down) {
            if (!going || !park().ok) { game.setFire(false); return; }
            game.setFire(down);
        }
        ui.onClick('BTN_FIRE', () => { if (going && park().ok && Date.now() - knobT > 500 && !ctl.fire) game.trigger(); });
        // (a start by "Play" or "New game" has no press to wait for: the title screen takes the next one)

        /* ---------- main menu ---------- */
        function menu() {
            const pk = park();
            let info;
            if (!pk.ok) info = 'The game waits: ' + pk.say;
            else if (game.playing()) info = 'Game waiting: stage ' + game.stage + ', score ' + game.score;
            else info = 'Turn the controller to move, press it to fire; the pedal flies the ship forward' + (hi ? '. High score ' + hi : '');
            ui.text('BTN_PLAY', game.playing() ? 'Continue' : 'Play');
            ui.text('MENU_INFO', info);
        }
        ui.onClick('BTN_PLAY', () => ui.open('GAME'));
        ui.onClick('BTN_NEW', () => { game.toTitle(); ui.open('GAME'); });
        menu();
        setInterval(() => { if (ui.isVisible('MAIN')) menu(); }, 2000);

        function sync() {
            const go = shown();
            if (go === going) return;
            going = go;
            // the controller to the game alone while it shows (BACK and MENU still work)
            if (ctx.controller) ctx.controller.grab(go);
            if (go) {
                last = 0;
                if (game.playing()) holdUntil = Date.now() + RESUME_MS;
            } else {
                game.setFire(false);
                ctl.setActive(false);
                saveHi();
                menu();
            }
        }
        setInterval(sync, 200);
        if (ui.onFocus) ui.onFocus(() => sync());

        /* ---------- one frame ---------- */
        const field = new Surface(FW, FH), left = new Panel(), right = new Panel();

        /** Feed the controls, step the game by the time that passed; returns the lines of a pause box, or null. */
        function advance() {
            const now = Date.now(), pk = park(), c = ctl.read();
            let dt = last ? now - last : FRAME_MS;
            last = now;
            // (not parked: the pedal and the controller are not the game's, and nothing starts)
            game.setControl(c.x, c.y, pk.ok);
            if (!pk.ok) game.setFire(false);
            let pause = null;
            if (game.playing()) {
                if (!pk.ok) pause = ['PAUSED'].concat(pk.why);
                else if (now < holdUntil) pause = ['GET READY'];
            }
            game.notice = pk.ok ? null : pk.why;
            game.hint = c.pedalLive ? null : 'NO PEDAL DATA YET - IGNITION ON?';
            ctl.setActive(pk.ok && !pause);
            stepped = 0;
            if (!pause && (pk.ok || !game.playing())) {
                // one step per frame while the renderer ticks at the display's 60 Hz, else by the clock
                if (dt >= 11 && dt <= 23) { game.step(); stepped = 1; acc = 0; } else {
                    acc += Math.min(dt, 250);
                    while (acc >= FRAME_MS && stepped < 8) { game.step(); acc -= FRAME_MS; stepped++; }
                    if (stepped === 8) acc = 0;
                }
            }
            for (const ev of game.events) {
                if (ev.type === 'start') { ctl.recentre(); log.info('game started'); } else if (ev.type === 'over') { log.info('game over: ' + ev.score + ' points, stage ' + ev.stage); saveHi(); }
            }
            game.events.length = 0;
            return { pause, pk, c };
        }

        /** Where the playfield and the panels go in an area w x h: a whole multiple of 320 x 240, centred. */
        function layout(w, h) {
            const s = Math.max(1, Math.floor(Math.min(h / FH, w / FW)));
            const x = Math.round((w - FW * s) / 2), y = Math.round((h - FH * s) / 2);
            const panels = settings.get('panels') !== false && x >= PW * s;
            return { s, x, y, panels };
        }

        let sr = null, frames = 0;
        function render() {
            const st = advance(), pauseKey = st.pause ? st.pause.join('|') : '';
            // the pictures: the playfield when the game moved (or its pause box changed), a panel when its content did
            if (stepped || pauseKey !== lastPause || !frames) {
                game.draw(field, st.pause);
                setImage(FIELD, FW, FH, field.data);
                lastPause = pauseKey;
            }
            const cv = ctx.canvas(W, H).clear('#000000');
            const pl = cv.place, full = !!(pl && pl.full);
            const lay = full ? layout(pl.w, pl.h) : layout(W, H);
            if (lay.panels) {
                const auto = game.autoFire, pedal = ctl.pedal(), speed = parked.speed();
                const state = !st.pk.ok ? PANEL_WHY[st.pk.why[0]] || ['NOT PARKED', C.R, ''] : st.pk.noCar ? ['NO CAR DATA', C.O, ''] : ['PARKED: READY', C.G, ''];
                if (left.update('help' + auto, (s) => drawHelp(s, { autoFire: auto }))) setImage(LEFT, left.s.w, left.s.h, left.s.data);
                const o = { knob: ctl.knobLive, x: st.c.x, pedal, y: st.c.y, selector: st.pk.selector, speed, autoFire: auto, fire: ctl.fire, state };
                const key = [o.knob, Math.round(st.c.x * 68), pedal === null ? 'n' : Math.round(pedal), Math.round(st.c.y * 68),
                    o.selector, speed === null ? 'n' : Math.round(speed), auto, o.fire, state[0], state[2]].join('|');
                if (right.update(key, (s) => drawGauges(s, o))) setImage(RIGHT, right.s.w, right.s.h, right.s.data);
            }
            // put together: screen pixels where the whole display is the game's, else the app's image area
            let out = cv;
            if (full) {
                if (!sr || sr.w !== pl.w || sr.h !== pl.h) sr = new Recorder(pl.w, pl.h);
                sr.reset();
                sr.fillRect(0, 0, pl.w, pl.h, '#000000');
                out = sr;
            }
            const fw = FW * lay.s, fh = FH * lay.s;
            out.image(FIELD, lay.x, lay.y, fw, fh);
            if (lay.panels) {
                out.image(LEFT, lay.x - PW * lay.s, lay.y, PW * lay.s, fh);
                out.image(RIGHT, lay.x + fw, lay.y, PW * lay.s, fh);
            }
            if (full) cv.xf(1, 0, 0).append(sr).xf();
            frames++;
            return ui.image('GAME_GFX', cv);
        }
        ctx.loop('GAME', 30, render);
        process.on('exit', () => { try { saveHi(); } catch (e) { /* exiting */ } });
        log.info('swarm drive started (high score ' + hi + ')');
    },
});
