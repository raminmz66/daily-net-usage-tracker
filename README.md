# Daily Net Usage Tracker

A GNOME Shell extension that shows how much data this machine has used **today**,
in the top bar.

```
                                      ┌──────────────┐
   Activities                         │  ↕ 4.2 GB    │  🔊  🔋  ▾
                                      └──────┬───────┘
                                             │  click
                                   ┌─────────▼──────────┐
                                   │ Download    3.8 GB │
                                   │ Upload      0.4 GB │
                                   └────────────────────┘
```

The number resets at local midnight. That is all it does — no history, no
graphs, no quotas.

## Install

Requires GNOME Shell 42 (Ubuntu 22.04). No dependencies beyond the shell itself.

```sh
git clone git@github.com:raminmz66/daily-net-usage-tracker.git
cd daily-net-usage-tracker
make install
```

Then restart GNOME Shell so it notices the new extension:

- **X11** — press `Alt`+`F2`, type `r`, press `Enter`. Windows are preserved.
- **Wayland** — log out and back in.

Finally:

```sh
make enable
```

The indicator appears at the right end of the top bar.

## What it counts

Only **physical** network interfaces: Wi-Fi, ethernet, USB tethers. An
interface qualifies if sysfs gives it a `device` entry, which means it is
backed by real hardware.

Everything virtual is excluded — loopback, `docker0` and other bridges, `veth`
pairs, and VPN tunnels such as `tun0`. Excluding the VPN is deliberate rather
than an oversight: traffic on `tun0` is re-encrypted and sent again over
`wlp3s0`, so counting both would report roughly double. Measuring at the
physical interface counts each byte once, on the wire, which is also what an
ISP or a mobile data plan bills you for.

On a typical developer machine that means:

```
counted:  wlp3s0, enp2s0
ignored:  lo, tun0, docker0, br-*, veth*
```

Sizes use decimal units (1 kB = 1000 B), the same convention data plans quote.

## How it works

The kernel cannot tell you how much data moved today. `rx_bytes` is a single
running total since the interface came up, with no time dimension attached and
no timestamped ledger anywhere behind it. So any daily figure has to come from
something that samples that counter and remembers. The only questions are how
early the sampling starts and what survives between runs.

The extension polls `/sys/class/net/<iface>/statistics/{rx,tx}_bytes` every 30
seconds and adds the difference since the previous poll. Deltas rather than
absolute readings, because those counters restart at zero whenever an interface
goes down and up, a driver reloads, or the machine reboots; a counter that came
back lower is treated as a reset rather than a negative delta.

State lives in `~/.local/share/daily-net-usage-tracker/usage.json`, written
every poll and on shutdown:

```json
{ "date": "2026-09-05", "rx": 4083201234, "tx": 391822104,
  "boot_id": "3cec499a-86d5-4a5d-891f-f2d11a44375d",
  "counters": { "wlp3s0": { "rx": 914913129, "tx": 216618694 } } }
```

The write goes through `g_file_set_contents`, which writes a temporary file and
renames it, so an unclean shutdown cannot leave the state truncated.

### Recovering time it was not running

Saving the counter positions alongside the totals — plus the boot ID and, from
`btime` in `/proc/stat`, when the machine booted — is what lets the extension
account for traffic that flowed while it was asleep. On startup, per interface:

| Situation | What it does |
|---|---|
| Same boot, we saved earlier today | The counter never restarted, so the difference since our saved reading is today's traffic. **Credit all of it.** |
| Same boot, counter came back lower | The interface restarted after a save we made today, so everything it shows is today's. **Credit all of it.** |
| Different boot, machine booted today | The counter restarted at boot and boot was after midnight. **Credit the whole counter**, on top of anything banked earlier today. This is what picks up the boot-to-login window. |
| Different boot, machine booted before midnight | The counter spans midnight with nothing marking the boundary. **Credit nothing** and count from here. |

Only the last row loses anything, and reaching it takes a specific shape: the
machine awake but **logged out** across midnight. Shut down instead and the
next boot lands in row three, which is exact. Stay logged in and the extension
rolls the day over live. Suspend and it rolls over on resume.

So a machine that is powered off overnight, and powered off and on again during
the day, gets an exact daily figure. What remains unrecoverable is at most one
poll interval of traffic before an unclean shutdown, since the next boot's
counter starts from zero.

### Layout

```
extension/
  extension.js        panel button, poll timer, wiring
  stylesheet.css
  lib/format.js       bytes -> "4.2 GB"
  lib/accumulator.js  deltas, counter resets, midnight rollover, startup recovery
  lib/counters.js     physical-interface discovery, sysfs reads
  lib/system.js       boot id and boot time, from procfs
  lib/store.js        load/save the state file
tests/run.js          test suite
docs/superpowers/specs/  design document
```

`format`, `accumulator`, `counters` and `system` contain all the logic and none
of the shell: `counters` and `system` take their sysfs and procfs roots as
arguments, `accumulator.resume()` is pure data in and data out, and `format` is
pure. That is what lets the tests run without a live session, including a
walk-through of a full day with two boots. `extension.js` is only wiring.

## Development

```sh
make test        # 56 tests under standalone gjs, no shell needed
make dev-link    # symlink instead of copy, so edits land on the next shell restart
make logs        # follow this extension's lines in the shell journal
make state       # print the persisted totals
```

Editing a loaded extension requires a shell restart (`Alt`+`F2`, `r` on X11) to
pick up the changes.

## Commands

| Command | Effect |
|---|---|
| `make install` | Copy into `~/.local/share/gnome-shell/extensions/` (runs the tests first) |
| `make enable` / `make disable` | Turn the indicator on or off |
| `make status` | What GNOME reports about the extension |
| `make uninstall` | Disable and remove it; usage data is left alone |
| `make pack` | Build a zip for manual install |

## Limits

- GNOME Shell 42 only. The extension uses the pre-45 `imports` module system,
  so GNOME 45 and later need it ported to ESM.
- Counting is per machine, not per application.
- Traffic is lost only in two narrow cases: an unclean shutdown drops up to one
  poll interval, and a machine left awake but logged out across midnight
  cannot have its counter split at the boundary.
- There is no way to reset the counter by hand. The number is a measurement.
- Yesterday's number is gone at midnight. That was the point.

## License

MIT — see [LICENSE](LICENSE).
