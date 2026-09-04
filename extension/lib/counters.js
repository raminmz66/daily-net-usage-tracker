'use strict';

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

var SYSFS_NET = '/sys/class/net';

/* Every function here takes the sysfs root as an argument so the test suite
 * can point it at a fixture tree instead of the real /sys. */

/* Physical NICs (wifi, ethernet, USB tethers) have a `device` entry in sysfs
 * pointing at real hardware. Loopback, docker bridges, veth pairs and VPN
 * tunnels do not, which is exactly the distinction we want: VPN traffic is
 * re-sent over the physical link, so counting tun0 as well would double it. */
var listPhysicalInterfaces = function (root = SYSFS_NET) {
    let enumerator;
    try {
        enumerator = Gio.File.new_for_path(root).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (e) {
        return [];   // no sysfs, or it is not readable
    }

    const names = [];
    try {
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            const device = GLib.build_filenamev([root, name, 'device']);
            if (GLib.file_test(device, GLib.FileTest.EXISTS))
                names.push(name);
        }
    } catch (e) {
        // Partial results are fine; a missing interface just misses one tick.
    } finally {
        enumerator.close(null);
    }
    return names;
};

function readCounter(root, iface, field) {
    const path = GLib.build_filenamev([root, iface, 'statistics', `${field}_bytes`]);
    let ok, contents;
    try {
        [ok, contents] = GLib.file_get_contents(path);
    } catch (e) {
        return null;
    }
    if (!ok)
        return null;

    const value = Number.parseInt(new TextDecoder().decode(contents).trim(), 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

/* Read rx/tx byte counters for the named interfaces. An interface whose
 * counters cannot be read is left out rather than reported as zero, so the
 * accumulator holds its baseline instead of seeing a bogus reset. */
var readSamples = function (interfaces, root = SYSFS_NET) {
    const samples = {};
    for (const iface of interfaces) {
        const rx = readCounter(root, iface, 'rx');
        const tx = readCounter(root, iface, 'tx');
        if (rx !== null && tx !== null)
            samples[iface] = { rx, tx };
    }
    return samples;
};

var sample = function (root = SYSFS_NET) {
    return readSamples(listPhysicalInterfaces(root), root);
};
