'use strict';
/**
 * Gets a checkout ready for the emulator and a car build (safe to run again):
 *
 *   1. the submodule vendor/idrive7-apps (the app kit and its emulator) at its pinned commit
 *   2. patches/idrive7-apps/*.patch applied to it, in name order: the emulator on Windows, and the
 *      emulator's Steering and Pedal signals (sliders, and the A / D / W keys)
 *   3. apps/<id> linked into the kit's apps/ (a junction on Windows), where its emulator looks
 *   4. a clearly marked placeholder for BMW's SDK in vendor/idrive7-apps/oap-sdk when there is no
 *      SDK: the kit's build stages every app with it, the emulator never loads it. Car builds
 *      refuse the placeholder (tools/build-car.js)
 *
 *   node tools/setup.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const KIT = path.join(ROOT, 'vendor', 'idrive7-apps');
const APPS = path.join(ROOT, 'apps');
const APP_ID = fs.readdirSync(APPS).filter((d) => fs.existsSync(path.join(APPS, d, 'app.json')))[0];
const SDK = path.join(KIT, 'oap-sdk');
const PLACEHOLDER = '0.0.0-emulator-placeholder';

const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const say = (s) => console.log('setup: ' + s);

function submodule() {
    if (fs.existsSync(path.join(KIT, 'kit', 'tools', 'emu.js'))) return;
    say('fetching the app kit (vendor/idrive7-apps)');
    execFileSync('git', ['submodule', 'update', '--init'], { cwd: ROOT, stdio: 'inherit' });
}

function patches() {
    const dir = path.join(ROOT, 'patches', 'idrive7-apps');
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.patch')).sort()) {
        const file = path.join(dir, name);
        try { git(['apply', '--reverse', '--check', file], KIT); continue; } catch (e) { /* not applied yet */ }
        try { git(['apply', '--check', file], KIT); } catch (e) {
            throw new Error(name + ' does not apply to vendor/idrive7-apps (another kit commit?):\n' + String(e.stderr || e.message));
        }
        git(['apply', file], KIT);
        say('applied ' + name);
    }
}

function link() {
    const target = path.join(APPS, APP_ID), at = path.join(KIT, 'apps', APP_ID);
    let st = null;
    try { st = fs.lstatSync(at); } catch (e) { /* not there */ }
    if (st) {
        if (st.isSymbolicLink() && path.resolve(path.dirname(at), fs.readlinkSync(at)) === target) return;
        throw new Error(path.relative(ROOT, at) + ' exists and is not a link to apps/' + APP_ID + ': move it away and run setup again');
    }
    fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
    // (the kit's own "git status" stays clean)
    const exclude = path.resolve(KIT, git(['rev-parse', '--git-path', 'info/exclude'], KIT));
    const have = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (have.indexOf('/apps/' + APP_ID) < 0) fs.appendFileSync(exclude, (have && !have.endsWith('\n') ? '\n' : '') + '/apps/' + APP_ID + '\n');
    say('linked apps/' + APP_ID + ' into vendor/idrive7-apps/apps');
}

function sdkPlaceholder() {
    if (fs.existsSync(path.join(SDK, 'index.js'))) return;
    fs.mkdirSync(SDK, { recursive: true });
    fs.writeFileSync(path.join(SDK, 'package.json'), JSON.stringify({
        name: 'oap-sdk', version: PLACEHOLDER,
        description: "NOT BMW's SDK: an empty stand-in so the kit's build can stage apps for the emulator. A car build needs the real SDK from your own head unit (kit/tools/extract_sdk.js).",
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(SDK, 'index.js'), "'use strict';\n// NOT BMW's SDK: an empty stand-in so the kit's build can stage apps for the emulator (which never loads it).\n" +
        "throw new Error('oap-sdk emulator placeholder: extract the real SDK from your own head unit (kit/tools/extract_sdk.js)');\n");
    say('no SDK found: wrote the emulator placeholder (vendor/idrive7-apps/oap-sdk)');
}

/** true when vendor/idrive7-apps/oap-sdk is the placeholder (or missing) */
function sdkIsPlaceholder() {
    try { return JSON.parse(fs.readFileSync(path.join(SDK, 'package.json'), 'utf8')).version === PLACEHOLDER; } catch (e) { return true; }
}

function setup() {
    submodule();
    patches();
    link();
    sdkPlaceholder();
}

module.exports = { setup, sdkIsPlaceholder, ROOT, KIT, APP_ID };

if (require.main === module) {
    try { setup(); say('ready'); } catch (e) { console.error('setup: ' + e.message); process.exit(1); }
}
