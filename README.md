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
                                   ├────────────────────┤
                                   │ Reset today's count│
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

The extension polls `/sys/class/net/<iface>/statistics/{rx,tx}_bytes` every
five seconds and adds the difference since the previous poll to the day's
running total.

Polling deltas rather than reading a single number matters, because those
kernel counters restart at zero whenever an interface goes down and up, a
driver reloads, or the machine reboots. When a counter comes back lower than
last time, the extension treats the whole current value as new traffic instead
of recording a negative delta.

Totals are written to `~/.local/share/daily-net-usage-tracker/usage.json` at
most once every 15 seconds, and always when the extension shuts down:

```json
{ "date": "2026-09-04", "rx": 4083201234, "tx": 391822104 }
```

The write goes through `g_file_set_contents`, which writes a temporary file and
renames it, so an unclean shutdown cannot leave the state truncated. A file
that is missing, corrupt, or dated to an earlier day simply starts the day at
zero.

Per-interface baselines are held in memory only. After a reboot or a shell
restart the extension re-baselines from the current counters — traffic that
flowed while it was not running is not counted — but the day's total is
reloaded from disk, so the number picks up where it left off.

### Layout

```
extension/
  extension.js        panel button, poll timer, wiring
  stylesheet.css
  lib/format.js       bytes -> "4.2 GB"
  lib/accumulator.js  deltas, counter resets, midnight rollover
  lib/counters.js     physical-interface discovery, sysfs reads
  lib/store.js        load/save today's totals
tests/run.js          test suite
docs/superpowers/specs/  design document
```

`format`, `accumulator` and `counters` contain all the logic and none of the
shell: `counters` takes its sysfs root as an argument, and the other two are
pure. That is what lets the tests run without a live session. `extension.js`
is only wiring.

## Development

```sh
make test        # 31 tests under standalone gjs, no shell needed
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
- Traffic during a reboot or shell restart is missed — seconds, in practice.
- Yesterday's number is gone at midnight. That was the point.

## License

MIT — see [LICENSE](LICENSE).
