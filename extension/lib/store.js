'use strict';

const GLib = imports.gi.GLib;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* Read today's totals back. Returns null when the file is absent, unreadable,
 * malformed, or does not hold the shape we expect -- all of which the caller
 * treats the same way: start the day at zero. */
var load = function (path) {
    let ok, contents;
    try {
        [ok, contents] = GLib.file_get_contents(path);
    } catch (e) {
        return null;
    }
    if (!ok)
        return null;

    let state;
    try {
        state = JSON.parse(new TextDecoder().decode(contents));
    } catch (e) {
        return null;
    }

    if (!state || typeof state !== 'object' || Array.isArray(state))
        return null;
    if (typeof state.date !== 'string' || !DATE_PATTERN.test(state.date))
        return null;
    for (const field of ['rx', 'tx']) {
        const value = state[field];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            return null;
    }

    return { date: state.date, rx: state.rx, tx: state.tx };
};

/* Write today's totals. g_file_set_contents writes to a temporary file and
 * renames it into place, so a crash mid-write cannot truncate the state. */
var save = function (path, state) {
    const dir = GLib.path_get_dirname(path);
    if (GLib.mkdir_with_parents(dir, 0o755) !== 0)
        throw new Error(`cannot create directory ${dir}`);
    if (!GLib.file_set_contents(path, JSON.stringify(state)))
        throw new Error(`cannot write ${path}`);
};
