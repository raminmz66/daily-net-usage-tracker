# Daily Net Usage Tracker — Design

**Date:** 2026-09-04
**Status:** Approved; revised 2026-09-05 (startup recovery, reset removed)
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
| Manual reset | None. The number is a measurement, not a scoreboard. |
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
  lib/system.js       boot id + boot time from procfs
  lib/accumulator.js  deltas, counter resets, rollover, startup recovery  (pure)
  lib/format.js       bytes -> "4.2 GB"                                   (pure)
  lib/store.js        load/save the state file as JSON
```

The interesting pieces (`format`, `accumulator`, `counters`, `system`) are pure
or filesystem-parameterised, so they run under plain `gjs` in a test harness
without a running shell. `extension.js` holds only wiring.

## Data flow

Every 30 seconds:

1. `counters.readSamples()` reads `/sys/class/net/<if>/statistics/{rx,tx}_bytes`
   for each interface that has a `device` entry (the physical test).
2. `accumulator.update(samples, today)` rolls the day over if the date changed,
   then adds each interface's delta since the previous sample to the running
   totals.
3. The panel label and the menu rows are re-rendered.
4. The state is persisted, every tick that changed anything and always on
   `disable()`. At ~200 bytes a write, throttling would buy nothing and would
   only widen the window an unclean shutdown can lose.

### Counter resets

`rx_bytes` restarts at zero when an interface goes down and up, when a driver
reloads, and on reboot. So a raw counter read is meaningless on its own; only
deltas between consecutive samples are. When a sample is *lower* than the
previous one for the same interface, the counter reset, and the whole current
value is treated as new traffic since that reset.

### Startup recovery

The kernel exposes no timestamped ledger, so the counter alone cannot say how
much of it belongs to today. Persisting the counter positions next to the
totals, along with the boot id and the boot date, makes the arithmetic possible
across a restart. `Accumulator.resume()` handles four situations per interface:

1. **Same boot, saved earlier today.** The counter never restarted; the
   difference since our reading is today's traffic. Credit all of it. A counter
   that came back *lower* means the interface restarted after a save we made
   today, so everything it shows is today's — credit that too.
2. **Different boot, machine booted today.** The counter restarted at boot and
   boot was after midnight, so the whole value is today's. Credit it on top of
   anything already banked today. This covers the boot-to-login window.
3. **Different boot, machine booted before midnight.** The counter spans
   midnight and nothing marked the boundary. Credit nothing, count from here.
   Only reachable when the machine was awake but logged out across midnight.
4. **A state file predating this format.** Its totals already include part of
   the current counter, so applying case 2 would count that twice. Keep the
   totals, credit nothing.

The rollover runs before the recovery, or a first-boot-of-the-day login would
credit the counter and then immediately zero it.

### Storage

`~/.local/share/daily-net-usage-tracker/usage.json`:

```json
{ "date": "2026-09-05", "rx": 4083201234, "tx": 391822104,
  "boot_id": "3cec499a-86d5-4a5d-891f-f2d11a44375d",
  "counters": { "wlp3s0": { "rx": 914913129, "tx": 216618694 } } }
```

A file whose totals are missing or malformed is discarded entirely. Counter
evidence is softer: if `boot_id` or `counters` is absent or corrupt, both are
dropped and the day's totals are kept, which lands in case 4.

Written with `g_file_set_contents`, which writes to a temporary file and
renames, so a crash mid-write cannot corrupt the file. A file that is missing,
malformed, or carries a stale date is treated as "today is zero".

## Presentation

- Panel: `↕ 4.2 GB` — combined rx+tx for today.
- Menu: `Download  3.8 GB`, `Upload  0.4 GB`. Nothing else — there is
  deliberately no way to reset the count by hand.
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
  first-sample baselining, midnight rollover, state round-trip.
- **resume** — each of the four cases above, an unknown boot date, seeded
  baselines, and a fresh install with no state file.
- **system** — boot id and `btime` parsing against a procfs fixture.
- **a day in the life** — an end-to-end walk through two boots in one day,
  asserting the total equals what the wire actually carried.
- **counters** — physical/virtual classification and counter parsing against a
  fixture tree that mirrors this machine's `/sys/class/net` (Wi-Fi, ethernet,
  `lo`, `docker0`, `tun0`).

Panel rendering and the timer are verified by hand in a live shell; they are
wiring, not logic.

## Out of scope

Per-day history, per-hour buckets, per-app attribution, quota alerts, live
throughput, a manual reset, and a preferences UI. A boot-to-shutdown sampler
daemon, and vnStat as a backend, were both considered and rejected: they buy
coverage only for time the machine is awake and logged out, at the cost of a
daemon or an external dependency. Constants that might plausibly need tuning
(poll interval, save interval, storage path) are named at the top of their
modules.
