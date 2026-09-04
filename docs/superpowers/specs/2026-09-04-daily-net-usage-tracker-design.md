# Daily Net Usage Tracker — Design

**Date:** 2026-09-04
**Status:** Approved
**Target:** GNOME Shell 42 (Ubuntu 22.04, X11)

## Problem

Show how much data this machine has sent and received *today*, at a glance,
in the GNOME top bar.

## Decisions

These were settled during brainstorming and are not open questions:

| Question | Decision |
|---|---|
| What counts as internet usage | Physical NICs only (Wi-Fi, ethernet, USB tether). VPN, docker bridges, veth, loopback excluded. |
| Bar display | Total only — `↕ 4.2 GB`. Down/up split lives in the dropdown. |
| History | Today only. Totals reset at local midnight; nothing is archived. |
| Delivery | A GNOME Shell extension, not a tray app or a daemon. |

Rationale for counting at physical NICs: VPN traffic on `tun0` is re-sent over
`wlp3s0`, so counting both double-counts. The physical interface is the wire —
it is what an ISP or a mobile plan would bill.

## Architecture

One GNOME Shell extension. No daemon, no runtime dependencies, no IPC. The
shell starts it at login and stops it at logout, which is exactly the window
during which the machine uses the network.

```
extension.js          panel button, 5s timer, wiring
  lib/counters.js     discover physical NICs + read byte counters from sysfs
  lib/accumulator.js  deltas, counter-reset handling, midnight rollover  (pure)
  lib/format.js       bytes -> "4.2 GB"                                  (pure)
  lib/store.js        load/save today's totals as JSON
```

The three interesting pieces (`format`, `accumulator`, `counters`) are pure or
filesystem-parameterised, so they run under plain `gjs` in a test harness
without a running shell. `extension.js` holds only wiring.

## Data flow

Every 5 seconds:

1. `counters.readSamples()` reads `/sys/class/net/<if>/statistics/{rx,tx}_bytes`
   for each interface that has a `device` entry (the physical test).
2. `accumulator.update(samples, today)` rolls the day over if the date changed,
   then adds each interface's delta since the previous sample to the running
   totals.
3. The panel label and the menu rows are re-rendered.
4. Totals are persisted, at most once every 15 seconds, and always on
   `disable()`, on rollover, and on manual reset.

### Counter resets

`rx_bytes` restarts at zero when an interface goes down and up, when a driver
reloads, and on reboot. So a raw counter read is meaningless on its own; only
deltas between consecutive samples are. When a sample is *lower* than the
previous one for the same interface, the counter reset, and the whole current
value is treated as new traffic since that reset.

Interface baselines are held in memory only and are never persisted. After a
shell restart the extension re-baselines from the current counters, which means
traffic during the restart itself is not counted. Persisted daily totals survive
the restart, so the day's number continues from where it left off.

### Storage

`~/.local/share/daily-net-usage-tracker/usage.json`:

```json
{ "date": "2026-09-04", "rx": 4083201234, "tx": 391822104 }
```

Written with `g_file_set_contents`, which writes to a temporary file and
renames, so a crash mid-write cannot corrupt the file. A file that is missing,
malformed, or carries a stale date is treated as "today is zero".

## Presentation

- Panel: `↕ 4.2 GB` — combined rx+tx for today.
- Menu: `Download  3.8 GB`, `Upload  0.4 GB`, separator, `Reset today's count`.
- Units are decimal (kB = 1000 B), matching how data plans are quoted.
- A `min-width` on the label keeps the panel from shuffling as digits change.
  (St's CSS subset has no `font-feature-settings`, so tabular figures are not
  an option.)

## Error handling

The extension must never break the shell. Every filesystem read is guarded;
an unreadable interface is skipped for that tick rather than throwing. A failed
save is logged and retried on the next tick. If no physical interface is found,
the extension shows `↕ 0 B` rather than an error.

## Testing

`make test` runs `tests/run.js` under standalone `gjs`. Covered:

- **format** — unit boundaries, rounding promotion (999,999,999 B renders as
  `1.0 GB`, not `1000.0 MB`), zero and garbage input.
- **accumulator** — normal deltas, multi-interface sums, counter reset mid-day,
  first-sample baselining, midnight rollover, manual reset, state round-trip.
- **counters** — physical/virtual classification and counter parsing against a
  fixture tree that mirrors this machine's `/sys/class/net` (Wi-Fi, ethernet,
  `lo`, `docker0`, `tun0`).

Panel rendering and the timer are verified by hand in a live shell; they are
wiring, not logic.

## Out of scope

Per-day history, per-hour buckets, per-app attribution, quota alerts, live
throughput, and a preferences UI. Constants that might plausibly need tuning
(poll interval, save interval, storage path) are named at the top of their
modules.
