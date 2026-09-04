'use strict';

/* Turns successive raw interface counters into a running daily total.
 *
 * Raw sysfs counters are meaningless on their own: they restart at zero
 * whenever an interface goes down and up, a driver reloads, or the machine
 * reboots. Only the delta between two consecutive samples is real traffic.
 *
 * Per-interface baselines live in memory only and are deliberately not
 * persisted: after a restart we cannot know what happened while we were not
 * running, so we re-baseline and keep counting from there. The daily totals
 * themselves do survive, via lib/store.js.
 */

const FIELDS = ['rx', 'tx'];

function sanitize(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

var Accumulator = class Accumulator {
    /* state: { date: 'YYYY-MM-DD', rx: Number, tx: Number } */
    constructor(state) {
        this.date = state.date;
        this.rx = state.rx;
        this.tx = state.tx;
        this._last = new Map();
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

    /* Zero the day without disturbing the baselines, so counting continues
     * from the current counter values rather than spiking. */
    reset(today) {
        this.date = today;
        this.rx = 0;
        this.tx = 0;
    }

    toState() {
        return { date: this.date, rx: this.rx, tx: this.tx };
    }
};
