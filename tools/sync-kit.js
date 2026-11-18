'use strict';
/**
 * Copies the part of the app kit that builds the app into kit/ at the repository root.
 *
 * Why there are two copies of the kit: the MGU Store builds an app from a repository's files on
 * the head unit itself (mgu-repo.json: python kit/tools/build.py <id>), from a download of the
 * repository that does not include submodules. So the build script, the runtime it packs into the
 * app and the permissions template are kept here as plain files. The whole kit, with its
 * emulator and installer, is the submodule vendor/idrive7-apps (for development).
 *
 * The copy is taken from the submodule's commit, not from its working folder (setup.js patches
 * the emulator there), so it is the kit exactly as published. kit/UPSTREAM.json says which commit.
 *
 *   node tools/sync-kit.js           copy (after moving the submodule to a new commit)
 *   node tools/sync-kit.js --check   only say whether kit/ matches the submodule's commit
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const KIT = path.join(ROOT, 'vendor', 'idrive7-apps');
// what kit/tools/build.py reads for an English build of an app with its own icon.png
const PATHS = ['kit/runtime', 'kit/platform', 'kit/tools/build.py', 'kit/tools/pack_data.py', 'kit/tools/localize.py', 'kit/tools/locale-revisions.json', 'kit/tools/oapgen'];
const EXTRA = { 'LICENSE': 'kit/LICENSE' };       // the kit's licence goes along with its files

const git = (args, opts) => execFileSync('git', args, Object.assign({ cwd: KIT, maxBuffer: 64 << 20 }, opts));

function files() {
    const list = git(['ls-tree', '-r', '--name-only', 'HEAD', '--'].concat(PATHS)).toString().split('\n').filter(Boolean);
    const out = list.map((f) => ({ from: f, to: f }));
    Object.keys(EXTRA).forEach((f) => out.push({ from: f, to: EXTRA[f] }));
    return out;
}

function main() {
    const check = process.argv.indexOf('--check') >= 0;
    if (!fs.existsSync(path.join(KIT, '.git'))) { console.error('sync-kit: vendor/idrive7-apps is not checked out (node tools/setup.js)'); process.exit(1); }
    const commit = git(['rev-parse', 'HEAD']).toString().trim();
    const list = files();
    const want = new Set(list.map((f) => f.to).concat(['kit/UPSTREAM.json']));
    let changed = 0;
    for (const f of list) {
        const data = git(['show', 'HEAD:' + f.from]), dst = path.join(ROOT, f.to);
        let same = false;
        try { same = fs.readFileSync(dst).equals(data); } catch (e) { /* not there */ }
        if (same) continue;
        changed++;
        if (check) { console.log('differs: ' + f.to); continue; }
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, data);
    }
    // files that are no longer part of the kit
    const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).reduce((a, n) => { const p = path.join(dir, n); return a.concat(fs.statSync(p).isDirectory() ? walk(p) : [p]); }, []) : []);
    for (const p of walk(path.join(ROOT, 'kit'))) {
        const rel = path.relative(ROOT, p).split(path.sep).join('/');
        if (want.has(rel)) continue;
        changed++;
        if (check) console.log('not in the kit: ' + rel); else fs.unlinkSync(p);
    }
    const stamp = JSON.stringify({ repository: 'https://github.com/cauliflowermossgrape/idrive7-apps', commit, paths: PATHS }, null, 2) + '\n';
    const stampFile = path.join(ROOT, 'kit', 'UPSTREAM.json');
    let stamped = false;
    try { stamped = fs.readFileSync(stampFile, 'utf8') === stamp; } catch (e) { /* none */ }
    if (!stamped) { changed++; if (check) console.log('differs: kit/UPSTREAM.json'); else fs.writeFileSync(stampFile, stamp); }
    if (check) {
        console.log(changed ? 'sync-kit: kit/ does not match vendor/idrive7-apps at ' + commit.slice(0, 7) + ' (run node tools/sync-kit.js)' : 'sync-kit: kit/ matches vendor/idrive7-apps at ' + commit.slice(0, 7));
        process.exit(changed ? 1 : 0);
    }
    console.log('sync-kit: kit/ is vendor/idrive7-apps at ' + commit.slice(0, 7) + ' (' + list.length + ' files, ' + changed + ' written or removed)');
}

main();
