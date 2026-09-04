'use strict';

const GLib = imports.gi.GLib;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validCounters(counters) {
    if (!counters || typeof counters !== 'object' || Array.isArray(counters))
        return null;
    const clean = {};
    for (const iface of Object.keys(counters)) {
        const entry = counters[iface];
        if (!entry || typeof entry !== 'object')
            return null;
        for (const field of ['rx', 'tx']) {
            const value = entry[field];
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
                return null;
        }
        clean[iface] = { rx: entry.rx, tx: entry.tx };
    }
    return clean;
}

/* Read the saved state back. Returns null when the file is absent,
 * unreadable, malformed, or missing the totals -- all of which the caller
 * treats the same way: start the day at zero.
 *
 * The counter evidence is softer. A file written by an older version has no
 * boot_id or counters at all, and a corrupt pair should not cost us a
 * perfectly good daily total, so both come back as null and the caller falls
 * back to counting from now. */
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

    const bootId = typeof state.boot_id === 'string' && state.boot_id
        ? state.boot_id : null;
    const counters = validCounters(state.counters);

    return {
        date: state.date,
        rx: state.rx,
        tx: state.tx,
        boot_id: counters === null ? null : bootId,
        counters: bootId === null ? null : counters,
    };
};

/* Write the state. g_file_set_contents writes to a temporary file and renames
 * it into place, so a crash mid-write cannot truncate what we have. */
var save = function (path, state) {
    const dir = GLib.path_get_dirname(path);
    if (GLib.mkdir_with_parents(dir, 0o755) !== 0)
        throw new Error(`cannot create directory ${dir}`);
    if (!GLib.file_set_contents(path, JSON.stringify(state)))
        throw new Error(`cannot write ${path}`);
};
