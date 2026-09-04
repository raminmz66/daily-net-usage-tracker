'use strict';

/* Turns successive raw interface counters into a running daily total.
 *
 * Raw sysfs counters are meaningless on their own: they restart at zero
 * whenever an interface goes down and up, a driver reloads, or the machine
 * reboots. Only the difference between two readings is real traffic.
 *
 * The hard part is the first reading after a start, when the counter shows a
 * number we did not watch accumulate. Accumulator.resume() works out how much
 * of it belongs to today; see the cases documented there.
 */

const FIELDS = ['rx', 'tx'];

function sanitize(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

var Accumulator = class Accumulator {
    /* state: { date, rx, tx, bootId?, counters? } */
    constructor(state) {
        this.date = state.date;
        this.rx = state.rx;
        this.tx = state.tx;
        this.bootId = state.bootId ?? null;
        this._last = new Map();

        const counters = state.counters || {};
        for (const iface of Object.keys(counters)) {
            const entry = {};
            for (const field of FIELDS) {
                const value = sanitize((counters[iface] || {})[field]);
                if (value !== null)
                    entry[field] = value;
            }
            this._last.set(iface, entry);
        }
    }

    get total() {
        return this.rx + this.tx;
    }

    /* samples: { iface: { rx, tx } }, today: 'YYYY-MM-DD'.
     * Returns true if the displayed totals changed. */
    update(samples, today) {
        let changed = false;

        // Roll over before counting, so traffic seen in this tick lands in
        // the new day rather than being discarded with the old one.
        if (today !== this.date) {
            this.date = today;
            this.rx = 0;
            this.tx = 0;
            changed = true;
        }

        for (const iface of Object.keys(samples)) {
            const sample = samples[iface] || {};
            const previous = this._last.get(iface) || {};
            const next = {};

            for (const field of FIELDS) {
                const value = sanitize(sample[field]);
                if (value === null) {
                    // Unreadable this tick; hold the old baseline so the next
                    // good reading produces a sane delta rather than a spike.
                    if (previous[field] !== undefined)
                        next[field] = previous[field];
                    continue;
                }
                next[field] = value;

                const before = previous[field];
                if (before === undefined)
                    continue;   // first sight of this interface: baseline only

                // Going backwards means the counter reset, so everything it
                // reports now is traffic we have not counted yet.
                const delta = value >= before ? value - before : value;
                if (delta > 0) {
                    this[field] += delta;
                    changed = true;
                }
            }

            this._last.set(iface, next);
        }

        return changed;
    }

    toState() {
        const counters = {};
        for (const [iface, entry] of this._last) {
            if (entry.rx !== undefined && entry.tx !== undefined)
                counters[iface] = { rx: entry.rx, tx: entry.tx };
        }
        return {
            date: this.date,
            rx: this.rx,
            tx: this.tx,
            boot_id: this.bootId,
            counters,
        };
    }
};

/* Build an accumulator at startup, recovering whatever traffic happened while
 * nothing was running. Everything here is plain data in, plain data out.
 *
 *   stored    the last saved state, or null
 *   samples   interface counters as they read right now
 *   bootId    identifier of the running boot
 *   bootDate  local date the machine booted ('YYYY-MM-DD'), or null
 *   today     local date now
 *
 * Four situations, per interface:
 *
 *   1. Same boot, and we saved earlier today. The counter never restarted, so
 *      the difference between what we saved and what we see is traffic from
 *      today that we simply were not awake for. Count all of it. If the
 *      counter came back lower, the interface itself restarted after our last
 *      save -- which was today -- so everything it shows is today's. Count it.
 *
 *   2. Different boot, and the machine booted today. The counter restarted at
 *      boot, and boot was after midnight, so the whole current value is
 *      today's traffic. Count all of it, on top of anything already banked
 *      earlier today. This is what picks up the boot-to-login window.
 *
 *   3. Different boot, and the machine booted before midnight. The counter
 *      spans midnight and nothing marked the boundary, so it cannot be split.
 *      Count nothing and start from here. Only reachable when the machine was
 *      awake but logged out across midnight; a shutdown lands in case 2 and a
 *      running session rolls the day over live.
 *
 *   4. A state file from before this format existed. Its totals already
 *      include part of the current counter, so applying case 2 would count
 *      that traffic twice. Keep the totals, count nothing, start from here.
 */
Accumulator.resume = function ({ stored, samples, bootId, bootDate, today }) {
    const previous = stored ?? null;

    const hasEvidence = !!(previous &&
        typeof previous.boot_id === 'string' && previous.boot_id &&
        previous.counters);
    const sameBoot = hasEvidence && previous.boot_id === bootId;
    const storedIsToday = !!previous && previous.date === today;
    const bootedToday = bootDate !== null && bootDate === today;

    // A reboot is only safe to account for when we are sure the stored totals
    // do not already include part of the counter we are about to add: either
    // there are no stored totals at all, or they came with counter evidence.
    const canCreditWholeCounter = !sameBoot && bootedToday &&
        (previous === null || hasEvidence);

    const accumulator = new Accumulator({
        date: today,
        rx: storedIsToday ? previous.rx : 0,
        tx: storedIsToday ? previous.tx : 0,
        bootId,
    });

    const storedCounters = hasEvidence ? previous.counters : {};

    for (const iface of Object.keys(samples)) {
        const sample = samples[iface] || {};
        const baseline = {};

        for (const field of FIELDS) {
            const now = sanitize(sample[field]);
            if (now === null)
                continue;
            baseline[field] = now;

            let recovered = 0;
            if (canCreditWholeCounter) {
                recovered = now;                                    // case 2
            } else if (sameBoot && storedIsToday) {                 // case 1
                const before = sanitize((storedCounters[iface] || {})[field]);
                if (before !== null)
                    recovered = now >= before ? now - before : now;
            }                                                       // else 3, 4

            if (recovered > 0)
                accumulator[field] += recovered;
        }

        accumulator._last.set(iface, baseline);
    }

    return accumulator;
};
