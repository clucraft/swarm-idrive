'use strict';
/**
 * The game in the kit's live emulator (no car, no BMW software):
 *
 *   node tools/emu.js [--port 8077] [--no-touch] [--bg screenshot.png]   ->  http://localhost:8077
 *
 * Runs vendor/idrive7-apps kit/tools/emu.js on the app. Saving a file in apps/<id>/ rebuilds and
 * restarts the app while the page stays open.
 *
 * On the page: A / D turn the steering wheel, W presses the accelerator, Enter is the iDrive
 * controller's press, Backspace is BACK. The panel's Manual signals have the same wheel and pedal
 * as sliders, and the gear selector (the game runs in P only).
 */
const path = require('path');
const { spawn } = require('child_process');
const { setup, ROOT, KIT, APP_ID } = require('./setup');

setup();
console.log('emu: settings and the high score are kept in ' + path.relative(ROOT, path.join(KIT, 'preview', 'emu', APP_ID)));
const child = spawn(process.execPath, [path.join(KIT, 'kit', 'tools', 'emu.js'), APP_ID].concat(process.argv.slice(2)), { cwd: KIT, stdio: 'inherit' });
const stop = (code) => { try { child.kill(); } catch (e) { /* gone */ } process.exit(code || 0); };
child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
