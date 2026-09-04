'use strict';

// Decimal units, matching how ISPs and data plans quote usage: 1 kB = 1000 B.
// [suffix, divisor, decimal places]
const UNITS = [
    ['B', 1, 0],
    ['kB', 1e3, 0],
    ['MB', 1e6, 1],
    ['GB', 1e9, 1],
    ['TB', 1e12, 2],
];

/* Render a byte count as a short human-readable string, e.g. "4.2 GB".
 * Anything that is not a non-negative finite number renders as "0 B". */
var formatBytes = function (bytes) {
    let value = Number(bytes);
    if (!Number.isFinite(value) || value < 0)
        value = 0;

    let i = 0;
    while (i < UNITS.length - 1 && value >= UNITS[i + 1][1])
        i++;

    // Rounding can push a value up into the next unit: 999,999,999 B is
    // "1000.0 MB" once rounded, which should read as "1.0 GB" instead.
    const rounded = Number((value / UNITS[i][1]).toFixed(UNITS[i][2])) * UNITS[i][1];
    if (i < UNITS.length - 1 && rounded >= UNITS[i + 1][1])
        i++;

    const [suffix, divisor, decimals] = UNITS[i];
    return `${(value / divisor).toFixed(decimals)} ${suffix}`;
};
