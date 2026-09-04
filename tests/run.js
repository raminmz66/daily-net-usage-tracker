#!/usr/bin/env gjs
// Standalone test suite. Runs the pure/parameterised modules under plain gjs,
// with no GNOME Shell in sight:  make test
'use strict';

const GLib = imports.gi.GLib;
const System = imports.system;

const scriptPath = GLib.canonicalize_filename(System.programInvocationName, null);
const testsDir = GLib.path_get_dirname(scriptPath);
const rootDir = GLib.path_get_dirname(testsDir);
imports.searchPath.unshift(GLib.build_filenamev([rootDir, 'extension']));

const Format = imports.lib.format;
const Accumulator = imports.lib.accumulator;
const Counters = imports.lib.counters;
const Store = imports.lib.store;

const SYSNET = GLib.build_filenamev([testsDir, 'fixtures', 'sysnet']);

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

/* ---------------------------------------------------------------- harness */

let passed = 0;
const failures = [];
let currentGroup = '';

function group(name) {
    currentGroup = name;
    print(`\n  ${name}`);
}

function check(name, fn) {
    try {
        fn();
        passed++;
        print(`    ${GREEN}PASS${OFF} ${name}`);
    } catch (e) {
        failures.push(`${currentGroup} > ${name}: ${e.message}`);
        print(`    ${RED}FAIL${OFF} ${name}\n        ${e.message}`);
    }
}

function eq(actual, expected, what = 'value') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`${what}: expected ${b}, got ${a}`);
}

/* ----------------------------------------------------------------- format */

group('format.formatBytes');

check('renders bytes below 1 kB with no unit scaling', () => {
    eq(Format.formatBytes(0), '0 B');
    eq(Format.formatBytes(1), '1 B');
    eq(Format.formatBytes(999), '999 B');
});

check('uses decimal units, not binary', () => {
    eq(Format.formatBytes(1000), '1 kB');
    eq(Format.formatBytes(1024), '1 kB');
    eq(Format.formatBytes(1000000), '1.0 MB');
    eq(Format.formatBytes(1000000000), '1.0 GB');
});

check('shows one decimal for MB and GB', () => {
    eq(Format.formatBytes(12400000), '12.4 MB');
    eq(Format.formatBytes(4200000000), '4.2 GB');
});

check('promotes to the next unit when rounding would overflow', () => {
    // 999,999,999 B is 1000.0 MB once rounded, which should read as 1.0 GB
    eq(Format.formatBytes(999999999), '1.0 GB');
    eq(Format.formatBytes(999999), '1.0 MB');
    eq(Format.formatBytes(999.6), '1 kB');
});

check('scales past GB', () => {
    eq(Format.formatBytes(2500000000000), '2.50 TB');
});

check('treats garbage and negatives as zero', () => {
    eq(Format.formatBytes(-5), '0 B');
    eq(Format.formatBytes(NaN), '0 B');
    eq(Format.formatBytes(undefined), '0 B');
    eq(Format.formatBytes('nonsense'), '0 B');
});

/* ------------------------------------------------------------ accumulator */

group('accumulator.Accumulator');

const TODAY = '2026-09-04';
const TOMORROW = '2026-09-05';

function fresh(state) {
    return new Accumulator.Accumulator(state ?? { date: TODAY, rx: 0, tx: 0 });
}

check('first sample only baselines, it does not count', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 5000, tx: 2000 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 0, tx: 0 });
});

check('counts the delta between consecutive samples', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 5000, tx: 2000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 5500, tx: 2100 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 500, tx: 100 });
});

check('sums across several interfaces', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 100, tx: 10 }, enp0s31f6: { rx: 50, tx: 5 } }, TODAY);
    acc.update({ wlp3s0: { rx: 400, tx: 30 }, enp0s31f6: { rx: 90, tx: 25 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 340, tx: 40 });
});

check('treats a counter that went backwards as a reset', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 9000, tx: 9000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 9500, tx: 9200 } }, TODAY);
    acc.update({ wlp3s0: { rx: 300, tx: 100 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 800, tx: 300 });
});

check('an interface appearing later baselines without a spike', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 100, tx: 100 } }, TODAY);
    acc.update({ wlp3s0: { rx: 200, tx: 150 }, enp0s31f6: { rx: 8000000, tx: 500 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 100, tx: 50 });
});

check('an interface that disappears and returns is not double-counted', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 5000, tx: 5000 } }, TODAY);
    acc.update({}, TODAY);
    acc.update({ wlp3s0: { rx: 700, tx: 200 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 700, tx: 200 });
});

check('zeroes the totals when the date rolls over', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 1000, tx: 1000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 3000, tx: 2000 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 2000, tx: 1000 });
    acc.update({ wlp3s0: { rx: 3500, tx: 2200 } }, TOMORROW);
    eq(acc.toState(), { date: TOMORROW, rx: 500, tx: 200 },
       'traffic in the rollover tick belongs to the new day');
});

check('keeps its baselines across a rollover', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 1000, tx: 1000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 1000, tx: 1000 } }, TOMORROW);
    acc.update({ wlp3s0: { rx: 1100, tx: 1050 } }, TOMORROW);
    eq(acc.toState(), { date: TOMORROW, rx: 100, tx: 50 });
});

check('resumes from persisted totals', () => {
    const acc = fresh({ date: TODAY, rx: 4000, tx: 1000 });
    acc.update({ wlp3s0: { rx: 77, tx: 77 } }, TODAY);
    acc.update({ wlp3s0: { rx: 177, tx: 87 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 4100, tx: 1010 });
});

check('discards persisted totals from an earlier day', () => {
    const acc = fresh({ date: '2026-08-30', rx: 999, tx: 999 });
    acc.update({ wlp3s0: { rx: 10, tx: 10 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 0, tx: 0 });
});

check('reset zeroes the day but keeps counting from the current baseline', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 100, tx: 100 } }, TODAY);
    acc.update({ wlp3s0: { rx: 900, tx: 500 } }, TODAY);
    acc.reset(TODAY);
    eq(acc.toState(), { date: TODAY, rx: 0, tx: 0 });
    acc.update({ wlp3s0: { rx: 1000, tx: 550 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 100, tx: 50 });
});

check('reports whether the totals moved', () => {
    const acc = fresh();
    eq(acc.update({ wlp3s0: { rx: 100, tx: 100 } }, TODAY), false, 'baseline tick');
    eq(acc.update({ wlp3s0: { rx: 100, tx: 100 } }, TODAY), false, 'idle tick');
    eq(acc.update({ wlp3s0: { rx: 101, tx: 100 } }, TODAY), true, 'tick with traffic');
    eq(acc.update({ wlp3s0: { rx: 101, tx: 100 } }, TOMORROW), true, 'rollover tick');
});

check('total is rx plus tx', () => {
    const acc = fresh({ date: TODAY, rx: 30, tx: 12 });
    eq(acc.total, 42);
});

check('ignores an interface reporting garbage', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 100, tx: 100 } }, TODAY);
    acc.update({ wlp3s0: { rx: NaN, tx: 200 } }, TODAY);
    eq(acc.toState(), { date: TODAY, rx: 0, tx: 100 });
});

/* --------------------------------------------------------------- counters */

group('counters');

check('lists only physical interfaces', () => {
    eq(Counters.listPhysicalInterfaces(SYSNET).sort(),
       ['brokenif', 'enp0s31f6', 'wlp3s0']);
});

check('excludes loopback, docker bridges and the VPN tunnel', () => {
    const found = Counters.listPhysicalInterfaces(SYSNET);
    for (const virt of ['lo', 'docker0', 'tun0']) {
        if (found.includes(virt))
            throw new Error(`${virt} should not be counted as physical`);
    }
});

check('returns an empty list for a missing sysfs root', () => {
    eq(Counters.listPhysicalInterfaces('/nonexistent/sys/class/net'), []);
});

check('reads byte counters for the interfaces it is given', () => {
    eq(Counters.readSamples(['wlp3s0', 'enp0s31f6'], SYSNET), {
        wlp3s0: { rx: 5000, tx: 2000 },
        enp0s31f6: { rx: 700, tx: 300 },
    });
});

check('skips an interface whose counters cannot be read', () => {
    eq(Counters.readSamples(['wlp3s0', 'brokenif'], SYSNET), {
        wlp3s0: { rx: 5000, tx: 2000 },
    });
});

check('sample() discovers and reads in one step', () => {
    eq(Counters.sample(SYSNET), {
        wlp3s0: { rx: 5000, tx: 2000 },
        enp0s31f6: { rx: 700, tx: 300 },
    });
});

/* ------------------------------------------------------------------ store */

group('store');

const tmpDir = GLib.dir_make_tmp('dnu-test-XXXXXX');
const statePath = GLib.build_filenamev([tmpDir, 'nested', 'usage.json']);

check('returns null when no state file exists yet', () => {
    eq(Store.load(statePath), null);
});

check('creates missing parent directories on save', () => {
    Store.save(statePath, { date: TODAY, rx: 1, tx: 2 });
    eq(GLib.file_test(statePath, GLib.FileTest.EXISTS), true);
});

check('round-trips a state object', () => {
    Store.save(statePath, { date: TODAY, rx: 4083201234, tx: 391822104 });
    eq(Store.load(statePath), { date: TODAY, rx: 4083201234, tx: 391822104 });
});

check('rejects malformed json', () => {
    GLib.file_set_contents(statePath, '{ this is not json');
    eq(Store.load(statePath), null);
});

check('rejects a state object with missing or bad fields', () => {
    const bad = ['{}', '{"date":"nope","rx":1,"tx":2}', '{"date":"2026-09-04","rx":-1,"tx":2}',
                 '{"date":"2026-09-04","rx":"1","tx":2}', '[]', 'null'];
    for (const b of bad) {
        GLib.file_set_contents(statePath, b);
        eq(Store.load(statePath), null, `should reject ${b}`);
    }
});

GLib.spawn_command_line_sync(`rm -rf ${tmpDir}`);

/* ----------------------------------------------------------------- report */

print('');
if (failures.length === 0) {
    print(`${GREEN}  ${passed} passing${OFF}\n`);
} else {
    print(`${RED}  ${failures.length} failing${OFF}, ${passed} passing\n`);
    for (const f of failures)
        print(`    - ${f}`);
    print('');
}
System.exit(failures.length === 0 ? 0 : 1);
