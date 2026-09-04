#!/usr/bin/env gjs
// Standalone test suite. Runs the pure/parameterised modules under plain gjs,
// with no GNOME Shell in sight:  make test
'use strict';

const GLib = imports.gi.GLib;
const Gjs = imports.system;

const scriptPath = GLib.canonicalize_filename(Gjs.programInvocationName, null);
const testsDir = GLib.path_get_dirname(scriptPath);
const rootDir = GLib.path_get_dirname(testsDir);
imports.searchPath.unshift(GLib.build_filenamev([rootDir, 'extension']));

const Format = imports.lib.format;
const Accumulator = imports.lib.accumulator;
const Counters = imports.lib.counters;
const Store = imports.lib.store;
const System = imports.lib.system;

const SYSNET = GLib.build_filenamev([testsDir, 'fixtures', 'sysnet']);
const PROC = GLib.build_filenamev([testsDir, 'fixtures', 'proc']);
const PROC_NO_BTIME = GLib.build_filenamev([testsDir, 'fixtures', 'proc-nobtime']);

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

function totals(acc) {
    return { date: acc.date, rx: acc.rx, tx: acc.tx };
}

check('first sample only baselines, it does not count', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 5000, tx: 2000 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 0, tx: 0 });
});

check('counts the delta between consecutive samples', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 5000, tx: 2000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 5500, tx: 2100 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 500, tx: 100 });
});

check('sums across several interfaces', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 100, tx: 10 }, enp0s31f6: { rx: 50, tx: 5 } }, TODAY);
    acc.update({ wlp3s0: { rx: 400, tx: 30 }, enp0s31f6: { rx: 90, tx: 25 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 340, tx: 40 });
});

check('treats a counter that went backwards as a reset', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 9000, tx: 9000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 9500, tx: 9200 } }, TODAY);
    acc.update({ wlp3s0: { rx: 300, tx: 100 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 800, tx: 300 });
});

check('an interface appearing later baselines without a spike', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 100, tx: 100 } }, TODAY);
    acc.update({ wlp3s0: { rx: 200, tx: 150 }, enp0s31f6: { rx: 8000000, tx: 500 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 100, tx: 50 });
});

check('an interface that disappears and returns is not double-counted', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 5000, tx: 5000 } }, TODAY);
    acc.update({}, TODAY);
    acc.update({ wlp3s0: { rx: 700, tx: 200 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 700, tx: 200 });
});

check('zeroes the totals when the date rolls over', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 1000, tx: 1000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 3000, tx: 2000 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 2000, tx: 1000 });
    acc.update({ wlp3s0: { rx: 3500, tx: 2200 } }, TOMORROW);
    eq(totals(acc), { date: TOMORROW, rx: 500, tx: 200 },
       'traffic in the rollover tick belongs to the new day');
});

check('keeps its baselines across a rollover', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 1000, tx: 1000 } }, TODAY);
    acc.update({ wlp3s0: { rx: 1000, tx: 1000 } }, TOMORROW);
    acc.update({ wlp3s0: { rx: 1100, tx: 1050 } }, TOMORROW);
    eq(totals(acc), { date: TOMORROW, rx: 100, tx: 50 });
});

check('resumes from persisted totals', () => {
    const acc = fresh({ date: TODAY, rx: 4000, tx: 1000 });
    acc.update({ wlp3s0: { rx: 77, tx: 77 } }, TODAY);
    acc.update({ wlp3s0: { rx: 177, tx: 87 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 4100, tx: 1010 });
});

check('discards persisted totals from an earlier day', () => {
    const acc = fresh({ date: '2026-08-30', rx: 999, tx: 999 });
    acc.update({ wlp3s0: { rx: 10, tx: 10 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 0, tx: 0 });
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
    eq(totals(acc), { date: TODAY, rx: 0, tx: 100 });
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

group('accumulator.toState');

check('serialises totals, boot id and baselines', () => {
    const acc = new Accumulator.Accumulator({
        date: TODAY, rx: 5, tx: 6, bootId: 'boot-a',
        counters: { wlp3s0: { rx: 10, tx: 20 } },
    });
    eq(acc.toState(), {
        date: TODAY, rx: 5, tx: 6, boot_id: 'boot-a',
        counters: { wlp3s0: { rx: 10, tx: 20 } },
    });
});

check('round-trips through a constructor', () => {
    const first = new Accumulator.Accumulator({
        date: TODAY, rx: 1, tx: 2, bootId: 'boot-a',
        counters: { wlp3s0: { rx: 100, tx: 200 } },
    });
    const second = new Accumulator.Accumulator({
        date: first.date, rx: first.rx, tx: first.tx,
        bootId: first.bootId, counters: first.toState().counters,
    });
    second.update({ wlp3s0: { rx: 150, tx: 260 } }, TODAY);
    eq(totals(second), { date: TODAY, rx: 51, tx: 62 },
       'baselines survived the round trip');
});

check('leaves out interfaces with an incomplete baseline', () => {
    const acc = fresh();
    acc.update({ wlp3s0: { rx: 10, tx: 'bad' } }, TODAY);
    eq(acc.toState().counters, {});
});

/* ----------------------------------------------------------------- resume */

group('accumulator.resume');

const YESTERDAY = '2026-09-03';
const BOOT_A = 'boot-a';
const BOOT_B = 'boot-b';

function saved(overrides) {
    return Object.assign({
        date: TODAY, rx: 1000, tx: 500, boot_id: BOOT_A,
        counters: { wlp3s0: { rx: 900000, tx: 300000 } },
    }, overrides);
}

check('case 1: same boot, counter moved on while we were not running', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved(),
        samples: { wlp3s0: { rx: 950000, tx: 310000 } },
        bootId: BOOT_A, bootDate: TODAY, today: TODAY,
    });
    // 50000 down and 10000 up happened while we were away; both are today's
    eq(totals(acc), { date: TODAY, rx: 51000, tx: 10500 });
});

check('case 1: same boot, counter went backwards since our last save', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved(),
        samples: { wlp3s0: { rx: 700, tx: 200 } },
        bootId: BOOT_A, bootDate: TODAY, today: TODAY,
    });
    // the interface restarted after a save we made today, so all of it is today's
    eq(totals(acc), { date: TODAY, rx: 1700, tx: 700 });
});

check('case 2: rebooted today, whole counter is added onto today total', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved(),
        samples: { wlp3s0: { rx: 80000, tx: 4000 } },
        bootId: BOOT_B, bootDate: TODAY, today: TODAY,
    });
    // the 15:00 restart: morning's 1000/500 plus everything since the new boot
    eq(totals(acc), { date: TODAY, rx: 81000, tx: 4500 });
});

check('case 2: rebooted today after a stale day, totals roll over first', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved({ date: '2026-08-30' }),
        samples: { wlp3s0: { rx: 80000, tx: 4000 } },
        bootId: BOOT_B, bootDate: TODAY, today: TODAY,
    });
    // the 10:00 login: yesterday's total is dropped, not added to
    eq(totals(acc), { date: TODAY, rx: 80000, tx: 4000 });
});

check('case 2: fresh install with no state file still credits this boot', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: null,
        samples: { wlp3s0: { rx: 80000, tx: 4000 } },
        bootId: BOOT_B, bootDate: TODAY, today: TODAY,
    });
    eq(totals(acc), { date: TODAY, rx: 80000, tx: 4000 });
});

check('case 3: booted before midnight, counter cannot be split', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved({ date: YESTERDAY }),
        samples: { wlp3s0: { rx: 5000000000, tx: 90000000 } },
        bootId: BOOT_B, bootDate: YESTERDAY, today: TODAY,
    });
    eq(totals(acc), { date: TODAY, rx: 0, tx: 0 });
});

check('case 3: same boot but our last save was yesterday', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved({ date: YESTERDAY }),
        samples: { wlp3s0: { rx: 5000000000, tx: 90000000 } },
        bootId: BOOT_A, bootDate: YESTERDAY, today: TODAY,
    });
    eq(totals(acc), { date: TODAY, rx: 0, tx: 0 });
});

check('case 4: a pre-format state file is not double-counted', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: { date: TODAY, rx: 1000, tx: 500, boot_id: null, counters: null },
        samples: { wlp3s0: { rx: 80000, tx: 4000 } },
        bootId: BOOT_B, bootDate: TODAY, today: TODAY,
    });
    // the old totals already include part of that counter, so credit nothing
    eq(totals(acc), { date: TODAY, rx: 1000, tx: 500 });
});

check('an unknown boot date is treated as unsplittable', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved(),
        samples: { wlp3s0: { rx: 80000, tx: 4000 } },
        bootId: BOOT_B, bootDate: null, today: TODAY,
    });
    // today's banked total stands, but nothing new is credited
    eq(totals(acc), { date: TODAY, rx: 1000, tx: 500 });
});

check('baselines are seeded so the next tick counts from here', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved(),
        samples: { wlp3s0: { rx: 950000, tx: 310000 } },
        bootId: BOOT_A, bootDate: TODAY, today: TODAY,
    });
    acc.update({ wlp3s0: { rx: 950500, tx: 310100 } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 51500, tx: 10600 });
});

check('records the current boot id for the next resume', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved(), samples: {}, bootId: BOOT_B, bootDate: TODAY, today: TODAY,
    });
    eq(acc.toState().boot_id, BOOT_B);
});

check('an interface missing from the stored counters is only baselined', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: saved(),
        samples: { wlp3s0: { rx: 900000, tx: 300000 }, enp2s0: { rx: 7777, tx: 111 } },
        bootId: BOOT_A, bootDate: TODAY, today: TODAY,
    });
    eq(totals(acc), { date: TODAY, rx: 1000, tx: 500 });
});

/* -------------------------------------------------------------- a whole day */

group('a day in the life');

/* The routine this was built for: boot around 10:00, power off at 14:00, boot
 * again at 15:00, power off at 23:00, machine off across midnight. Every
 * figure below is bytes on wlp3s0. */
check('two boots in a day add up to everything the wire carried', () => {
    const MB = 1000000;
    let saved = {                       // left over from yesterday evening
        date: YESTERDAY, rx: 7000 * MB, tx: 900 * MB, boot_id: 'boot-yesterday',
        counters: { wlp3s0: { rx: 7000 * MB, tx: 900 * MB } },
    };

    // 10:00 -- booted at 09:50, 80 MB already moved before the desktop appeared
    let acc = Accumulator.Accumulator.resume({
        stored: saved,
        samples: { wlp3s0: { rx: 80 * MB, tx: 5 * MB } },
        bootId: 'boot-morning', bootDate: TODAY, today: TODAY,
    });
    eq(totals(acc), { date: TODAY, rx: 80 * MB, tx: 5 * MB },
       'yesterday dropped, pre-login traffic credited');

    // 10:00-14:00 -- the counter climbs to 500 MB down, 40 MB up
    acc.update({ wlp3s0: { rx: 500 * MB, tx: 40 * MB } }, TODAY);
    eq(totals(acc), { date: TODAY, rx: 500 * MB, tx: 40 * MB }, 'morning session');
    saved = acc.toState();              // 14:00, saved on the way down

    // 15:00 -- fresh boot, counter back to zero, 30 MB before login
    acc = Accumulator.Accumulator.resume({
        stored: saved,
        samples: { wlp3s0: { rx: 30 * MB, tx: 2 * MB } },
        bootId: 'boot-afternoon', bootDate: TODAY, today: TODAY,
    });
    eq(totals(acc), { date: TODAY, rx: 530 * MB, tx: 42 * MB },
       'morning total carried over, new boot added on top');

    // 15:00-23:00 -- the counter climbs to 900 MB down, 60 MB up
    acc.update({ wlp3s0: { rx: 900 * MB, tx: 60 * MB } }, TODAY);

    // the wire carried 500 + 900 down and 40 + 60 up across the two boots
    eq(totals(acc), { date: TODAY, rx: 1400 * MB, tx: 100 * MB },
       'day total matches both boots summed');
});

check('a shell restart mid-session loses nothing', () => {
    const acc = Accumulator.Accumulator.resume({
        stored: null,
        samples: { wlp3s0: { rx: 1000, tx: 1000 } },
        bootId: BOOT_A, bootDate: TODAY, today: TODAY,
    });
    acc.update({ wlp3s0: { rx: 5000, tx: 3000 } }, TODAY);
    const saved = acc.toState();

    // shell restarts; 2500 bytes down and 400 up flow while nothing is running
    const after = Accumulator.Accumulator.resume({
        stored: saved,
        samples: { wlp3s0: { rx: 7500, tx: 3400 } },
        bootId: BOOT_A, bootDate: TODAY, today: TODAY,
    });
    eq(totals(after), { date: TODAY, rx: 7500, tx: 3400 },
       'the gap is recovered, so the total still equals the counter');
});

/* ----------------------------------------------------------------- system */

group('system');

check('reads the boot id', () => {
    eq(System.bootId(PROC), '3cec499a-86d5-4a5d-891f-f2d11a44375d');
});

check('returns null when the boot id is unreadable', () => {
    eq(System.bootId('/nonexistent/proc'), null);
});

check('reads btime out of /proc/stat', () => {
    eq(System.bootTime(PROC), 1757007349);
});

check('returns null when /proc/stat carries no btime', () => {
    eq(System.bootTime(PROC_NO_BTIME), null);
    eq(System.bootDate(PROC_NO_BTIME), null);
});

check('turns an epoch into a local calendar date', () => {
    const date = System.localDate(1757007349);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error(`not a date: ${date}`);
    const nextDay = System.localDate(1757007349 + 86400);
    if (nextDay === date)
        throw new Error('a day later should be a different date');
});

check('boot date is the local date of btime', () => {
    eq(System.bootDate(PROC), System.localDate(System.bootTime(PROC)));
});

/* ------------------------------------------------------------------ store */

group('store');

const tmpDir = GLib.dir_make_tmp('dnu-test-XXXXXX');
const statePath = GLib.build_filenamev([tmpDir, 'nested', 'usage.json']);

const FULL = {
    date: TODAY, rx: 4083201234, tx: 391822104, boot_id: BOOT_A,
    counters: { wlp3s0: { rx: 900000, tx: 300000 } },
};

check('returns null when no state file exists yet', () => {
    eq(Store.load(statePath), null);
});

check('creates missing parent directories on save', () => {
    Store.save(statePath, FULL);
    eq(GLib.file_test(statePath, GLib.FileTest.EXISTS), true);
});

check('round-trips the full state', () => {
    Store.save(statePath, FULL);
    eq(Store.load(statePath), FULL);
});

check('rejects malformed json', () => {
    GLib.file_set_contents(statePath, '{ this is not json');
    eq(Store.load(statePath), null);
});

check('rejects a state object with missing or bad totals', () => {
    const bad = ['{}', '{"date":"nope","rx":1,"tx":2}', '{"date":"2026-09-04","rx":-1,"tx":2}',
                 '{"date":"2026-09-04","rx":"1","tx":2}', '[]', 'null'];
    for (const b of bad) {
        GLib.file_set_contents(statePath, b);
        eq(Store.load(statePath), null, `should reject ${b}`);
    }
});

check('reads a pre-format file, reporting no counter evidence', () => {
    GLib.file_set_contents(statePath, '{"date":"2026-09-05","rx":10,"tx":20}');
    eq(Store.load(statePath),
       { date: '2026-09-05', rx: 10, tx: 20, boot_id: null, counters: null });
});

check('keeps the totals but drops corrupt counter evidence', () => {
    GLib.file_set_contents(statePath,
        '{"date":"2026-09-05","rx":10,"tx":20,"boot_id":"boot-a","counters":{"wlp3s0":{"rx":-1,"tx":2}}}');
    eq(Store.load(statePath),
       { date: '2026-09-05', rx: 10, tx: 20, boot_id: null, counters: null });
});

check('drops counter evidence that arrives without a boot id', () => {
    GLib.file_set_contents(statePath,
        '{"date":"2026-09-05","rx":10,"tx":20,"counters":{"wlp3s0":{"rx":1,"tx":2}}}');
    eq(Store.load(statePath),
       { date: '2026-09-05', rx: 10, tx: 20, boot_id: null, counters: null });
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
Gjs.exit(failures.length === 0 ? 0 : 1);
