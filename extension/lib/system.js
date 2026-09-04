'use strict';

const GLib = imports.gi.GLib;

var PROC = '/proc';

/* Facts about the running system that tell us whether the interface counters
 * we saved last time are still comparable to the ones we can read now.
 * The procfs root is an argument so the tests can use a fixture tree. */

function readText(path) {
    let ok, contents;
    try {
        [ok, contents] = GLib.file_get_contents(path);
    } catch (e) {
        return null;
    }
    return ok ? new TextDecoder().decode(contents) : null;
}

/* Identifies this boot. It changes on every reboot and survives suspend and
 * hibernate, which is exactly the distinction we need: a new boot id means the
 * interface counters restarted from zero, an unchanged one means they did not. */
var bootId = function (root = PROC) {
    const text = readText(GLib.build_filenamev([root, 'sys', 'kernel', 'random', 'boot_id']));
    if (text === null)
        return null;
    const id = text.trim();
    return id.length > 0 ? id : null;
};

/* Wall-clock time the machine booted, in epoch seconds. */
var bootTime = function (root = PROC) {
    const text = readText(GLib.build_filenamev([root, 'stat']));
    if (text === null)
        return null;
    for (const line of text.split('\n')) {
        if (!line.startsWith('btime '))
            continue;
        const seconds = Number.parseInt(line.slice('btime '.length).trim(), 10);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }
    return null;
};

var localDate = function (epochSeconds) {
    return GLib.DateTime.new_from_unix_local(epochSeconds).format('%Y-%m-%d');
};

/* Local calendar date the machine booted, or null if it cannot be worked out.
 * A null answer makes the caller fall back to counting from now, which is the
 * conservative choice. */
var bootDate = function (root = PROC) {
    const seconds = bootTime(root);
    return seconds === null ? null : localDate(seconds);
};
