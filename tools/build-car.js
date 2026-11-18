'use strict';
/**
 * A package for the kit's own installer over SSH (vendor/idrive7-apps deploy/, its README 3.3):
 * dist/<id>@<version>.mgu. The MGU Store needs none of this: it builds the app from the
 * repository on the head unit (README, "On the car").
 *
 *   node tools/build-car.js
 *
 * Needs BMW's SDK extracted from your own head unit in vendor/idrive7-apps/oap-sdk
 * (vendor/idrive7-apps/kit/tools/extract_sdk.js): the emulator's placeholder is refused.
 * The .mgu contains BMW's SDK: keep it for your own car and never publish it.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { setup, sdkIsPlaceholder, ROOT, KIT, APP_ID } = require('./setup');

setup();
if (sdkIsPlaceholder()) {
    console.error('build-car: vendor/idrive7-apps/oap-sdk is the emulator placeholder, not BMW\'s SDK.\n' +
        'Extract the SDK from your own head unit first (vendor/idrive7-apps README, "Get the SDK from your unit"),\n' +
        'or install through the MGU Store, which needs no SDK on your PC.');
    process.exit(1);
}
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
execFileSync(python, [path.join(KIT, 'kit', 'tools', 'build.py'), APP_ID], { cwd: KIT, stdio: 'inherit' });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', APP_ID, 'app.json'), 'utf8')).version;
const name = APP_ID + '@' + version + '.mgu';
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.copyFileSync(path.join(KIT, 'dist', name), path.join(ROOT, 'dist', name));
console.log('build-car: dist/' + name + ' (contains BMW\'s SDK: for your own car only, never publish it)');
