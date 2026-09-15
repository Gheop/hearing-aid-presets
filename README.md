# Hearing Aid Presets

Use LE Audio hearing aids on Linux, and switch their programs from the GNOME top bar.

![Top bar menu listing the hearing aid programs](docs/images/menu.webp)

Tested with a pair of **ReSound Vivia 960** on Fedora 44 (kernel 7.1 and 7.2, BlueZ 5.87, PipeWire 1.6.8, WirePlumber 0.5.14, GNOME 50, Intel AX211). Any hearing aid that implements the Bluetooth LE Audio *Hearing Access Service* (HAS) should work with the extension; the setup notes apply to any LE Audio device.

## Compatible devices

Tested here: **ReSound Vivia 960**, binaural pair (four programs, preset synchronisation, microphone control). The same GN platform is sold under several names, so these should behave identically:

- ReSound Vivia, ReSound Nexia, ReSound Savi
- Jabra Enhance Pro 20, Jabra Enhance Select 500
- Beltone Serene, Beltone Envision

Any hearing aid advertised as **Bluetooth LE Audio** or **Auracast** capable implements the same standard services (BAP for audio, HAS for programs, VCS/MICS for volume and microphone), so the setup and the extension should apply. Manufacturers listing LE Audio support at the time of writing, none of them tested by us:

- Oticon Intent
- Phonak Audéo Infinio and Sphere Infinio, Unitron Vivante
- Starkey Genesis AI, Edge AI
- Signia Integrated Xperience (IX), Rexton Reach
- Widex Allure
- Cochlear Nucleus 8 sound processor

The full lists, with what was checked and how to report yours, live in [docs/DEVICES.md](docs/DEVICES.md) (hearing aids) and [docs/CONTROLLERS.md](docs/CONTROLLERS.md) (Bluetooth adapters that do or do not support LE Audio). If you try one, open an issue with `bluetoothctl info <MAC>` and the program list you get: that is the only way these lists get better. Aids that only speak ASHA (older Android streaming) are not covered, see [Alternatives](#alternatives).

Keywords, for the search engines: Bluetooth LE Audio hearing aids on Linux, Auracast, HAP, HAS presets, LC3, BlueZ, PipeWire, WirePlumber, Fedora, GNOME Shell extension.

What you get:

- Stereo LC3 streaming from PipeWire to both aids, through the standard BlueZ + PipeWire stack. No third-party daemon.
- A GNOME Shell extension: an ear icon appears while the aids are connected, with a menu showing the model, the battery level of each ear, a volume slider per ear, and the programs ("Universal", "Noise", "Outdoor"...). One click switches both ears. The menu follows changes made on the aids or from the phone.
- A `connect-hearing-aids` script and a user service that connect the aids at login, check that the LE Audio stream really comes up, and work around the BlueZ quirks that otherwise leave you without sound, or with one silent ear, after a session restart or a reboot.

## Requirements

- A Bluetooth controller that supports LE Audio. Check with `sudo btmgmt info`: the `supported settings` line must contain `cis-central`. Intel AX2xx cards do; many cheap "Bluetooth 5.3" USB dongles (Realtek, Actions) do not, whatever the box says. See [docs/CONTROLLERS.md](docs/CONTROLLERS.md).
- BlueZ 5.77 or later, PipeWire 1.6 or later, a kernel with ISO socket support (6.x or later).
- `gettext` (`msgfmt`) to compile the menu translations at install time.
- GNOME Shell 50 for the extension (the `shell-version` field in `extension/metadata.json` is easy to widen if you test on 46 to 49).
- Hearing aids that advertise the LE Audio services. `bluetoothctl info <MAC>` should list `Audio Stream Control`, `Published Audio Capabilities`, `Common Audio` and `Hearing Aid`.

## Installation

### 1. bluetoothd

Edit `/etc/bluetooth/main.conf` and set, in `[General]`:

```ini
Experimental = true
KernelExperimental = 6fbaf188-05e0-496a-9885-d6ddfdb4e03e
```

The first line turns on the LE Audio profiles. The second enables the kernel ISO socket; without it bluetoothd logs `BAP requires ISO Socket which is not enabled` and only the ASHA profile shows up. See `bluetooth/main.conf.snippet`.

Then keep bluetoothd's built-in `vcp` plugin out of the way. It claims the Volume Control Service characteristics (the extension would get `Operation Not Authorized`) and, worse for hearing aids, it propagates any volume change to the whole coordinated set, so left and right can never differ:

```sh
sudo mkdir -p /etc/systemd/system/bluetooth.service.d
sudo cp bluetooth/noplugin-vcp.conf /etc/systemd/system/bluetooth.service.d/
sudo systemctl daemon-reload
sudo systemctl restart bluetooth
```

The override hard-codes Fedora's `/usr/libexec/bluetooth/bluetoothd`; on distributions that ship it elsewhere (`systemctl show -p ExecStart bluetooth` tells), edit the path in the copied file first.

The price: the GNOME volume slider no longer drives the aids' own volume through BlueZ and becomes a software gain on the stream, which is what you want anyway once the per-ear sliders exist. (`DisablePlugins` in `main.conf` is not a valid key in BlueZ 5.87, hence the systemd override.)

Optional: let the script restart bluetoothd by itself when BlueZ ends up holding a stale connection (see Troubleshooting, "One aid shows no GATT objects"). The rule grants exactly one thing: restarting `bluetooth.service`, to your user, without a password.

```sh
sed "s/@USER@/$USER/" bluetooth/50-hearing-aids-bluetooth.rules | sudo tee /etc/polkit-1/rules.d/50-hearing-aids-bluetooth.rules > /dev/null
```

### 2. User side

```sh
./install.sh
```

This copies the extension to `~/.local/share/gnome-shell/extensions/`, the script to `~/.local/bin/`, enables the `hearing-aids-connect` user service, and creates `~/.config/hearing-aids/devices.conf` if missing. Edit that file with the MAC addresses of your aids (`bluetoothctl devices`):

```sh
LEFT=CC:89:6C:E0:0D:0E
RIGHT=CC:89:6C:E0:57:E7
LEFT_ALIAS="Vivia"
RIGHT_ALIAS="Vivia R"
```

The aliases are optional. PipeWire attaches the single stereo sink to the left aid, so the left alias is what you see in the GNOME sound menu; a name without a side suffix reads better there.

### 3. Pair and log in again

Pair both aids once with the GNOME Bluetooth panel or `bluetoothctl` (put them in pairing mode). Then log out and back in: GNOME only loads new extensions at login, and the user service connects the aids as soon as WirePlumber has registered its LE Audio endpoints with BlueZ.

## Using it

Pick "Bluetooth – Vivia" (or your alias) as the output in the GNOME sound menu. PipeWire shows one stereo sink; the right aid is grouped into it through the LE Audio coordinated set.

The ear icon in the top bar opens the menu: battery level of each ear, one volume slider per ear, then the program list where the checked entry is the active program. The volume sliders drive the aids' own volume (what the buttons on the aids and the phone app change), independently for each ear; they follow changes made elsewhere. The header shows the manufacturer and model read from the Device Information Service ("ReSound Vivia 960"), or the device alias when the aid does not provide them. Menu strings are in English with a French translation; add a `po/<lang>.po` for another language and run `msgfmt` as in `install.sh`.

Battery levels come straight from each aid's Battery Level characteristic; bluetoothd itself does not publish `org.bluez.Battery1` for these aids (it logs `More than one BATT service exists for this device` and gives up), so the GNOME Bluetooth panel shows nothing.

The script sources `~/.config/hearing-aids/devices.conf` as shell. Besides the two addresses it understands `LEFT_ALIAS`, `RIGHT_ALIAS`, and `RESET_ON_BOOT=no` to skip the adapter reset described below. To check the stream it watches the BAP transports and, when it can, the bluetoothd journal; without access to the system journal it says so and relies on the transports alone (add yourself to the `systemd-journal` group for the full check).

On the first run after a boot, the script resets the Bluetooth adapter before connecting: bluetoothd reconnects trusted aids seconds after it starts, before your session's WirePlumber exists, and that early connection leaves an ISO group in the controller that makes the first stream fail with `Device or resource busy`. The reset costs about 7 s of Bluetooth right after login (a Bluetooth keyboard or mouse blinks too) and makes the aids connect with WirePlumber already listening. Later runs skip it.

Run `connect-hearing-aids` by hand whenever the aids are connected but silent, typically after PipeWire or bluetoothd restarted.

**Sound arrives a second after the video starts.** WirePlumber suspends the sink after 5 s of silence and BlueZ closes the ISO streams; the next sound waits for `LE Create CIS` on both aids (0.9 s measured here) before anything is heard. `bluetooth/wireplumber-suspend.conf.example` is a WirePlumber rule that keeps the stream open for 300 s instead: copy it to `~/.config/wireplumber/wireplumber.conf.d/` with your aids' addresses, restart WirePlumber, run `connect-hearing-aids`. The aids then decode an empty stream for 5 minutes after every silence, which costs battery; lower the value if that shows.

Hearing aids accept a single central at a time. While they are connected to your phone, the computer cannot connect. Turn off the phone's Bluetooth, or disconnect the aids from it, before connecting here.

## How it works

BlueZ exports every GATT characteristic of a connected device on D-Bus. The extension watches `org.bluez` through `ObjectManager`, finds the Hearing Access Service (`0x1854`) and its three characteristics, and talks HAP directly:

| Characteristic | UUID | Use |
|---|---|---|
| Hearing Aid Features | 0x2BDA | binaural or not, preset synchronisation support |
| Hearing Aid Preset Control Point | 0x2BDB | `0x01` Read Presets, `0x05` Set Active Preset, `0x08` Set Active Preset (synchronised) |
| Active Preset Index | 0x2BDC | current program, notified on change |

The preset list arrives as one indication per preset (opcode `0x02`). To switch, the extension writes `0x08 <index>` when the aids advertise preset synchronisation (the Vivia refuse the plain `0x05` with ATT error `0x80`), and falls back to `0x05` otherwise. Battery levels are the Battery Level characteristic (`0x2A19`) of each aid, and the sliders write Set Absolute Volume (`0x04`, change counter, volume 0..255) to the Volume Control Point (`0x2B7E`) of the Volume Control Service (`0x1844`), following Volume State (`0x2B7D`) notifications. Left and right come from the BAP endpoint `Locations` bitmask. The header comes from the Device Information Service (`0x180A`): Manufacturer Name String (`0x2A29`) and Model Number String (`0x2A24`), with a small table turning internal codes such as `VI960S-DRWC` into retail names.

No daemon, no polling: everything is driven by D-Bus signals.

For development, `gnome-shell --devkit --wayland` runs a second shell in a window against the real BlueZ, and `scripts/check` runs the static checks (JS syntax, shellcheck, translations) that CI runs.

## Troubleshooting

**No sound, or a weak sound on one side, after logging in or restarting PipeWire.** `pactl list cards` shows the aids' cards on profile `off` or `asha-sink`, and the WirePlumber log says `ASHA failed to flush ... written:-11`. BlueZ does not renegotiate BAP for aids that were already connected when PipeWire registered its endpoints. Run `connect-hearing-aids`: when the BAP profile does not come up it power-cycles the adapter so both aids reconnect together, then checks that both cards are on `bap-sink` and that both transports really carry audio. (Earlier versions disconnected and reconnected the aids instead; with BlueZ 5.87 that regularly ends in the state below.)

**Connected, BAP profile active, still no sound.** The bluetoothd journal shows `iso_connect_cb() connect to ...: Device or resource busy (16)`, repeated every 30 s while something plays. The HCI trace behind it ([bluez/bluez#2496](https://github.com/bluez/bluez/issues/2496)): the controller answers `Command Disallowed` to `LE Create CIS`, and keeps doing so even after bluetoothd removes and re-creates the CIG, reconnects the aids or is restarted. Only powering the adapter off and on clears it; the script does that on its first run after each boot, before connecting. `connect-hearing-aids` probes the stream with a few seconds of silence, checks that both transports go active and reads the journal, and does the power cycle by itself when needed. By hand: `bluetoothctl power off`, `bluetoothctl power on`, then reconnect the aids.

**One aid shows no GATT objects on D-Bus, or only an `asha-sink` profile** (`busctl tree org.bluez` lists nothing under its `dev_...` path, the extension only sees the other ear, no sound on that side). Seen with BlueZ 5.87 after an aid reconnects on its own right after a disconnect: bluetoothd logs `No matching connection for device` and attaches no profile, and neither a reconnection nor an adapter reset clears it. With the polkit rule from Installation in place, `connect-hearing-aids` gets out of it by itself: it restarts bluetoothd, then WirePlumber (which otherwise keeps stale ASHA nodes from before the restart and plays into the void), then reconnects. By hand:

```sh
sudo systemctl restart bluetooth && systemctl --user restart wireplumber && connect-hearing-aids
```

**`Cannot set the volume` notification, or the sliders snap back.** bluetoothd is running without `--noplugin=vcp`; check `systemctl show -p ExecStart bluetooth`.

**`BAP requires ISO Socket which is not enabled`** in the bluetoothd journal: the `KernelExperimental` line is missing.

**Light crackling.** Radio, in our experience: it did not change with Wi-Fi off (5 GHz) and got better after a clean reconnect of both aids. A controller closer to your head helps, provided it supports `cis-central`.

**The aids will not connect.** They are probably connected to your phone. Also, the first connection attempt after a bluetoothd restart often fails with `le-connection-abort-by-local`; the script retries once.

## Reporting the stale ISO group upstream

The "busy" after boot is a BlueZ or kernel bug: an LE Audio device connected before any BAP endpoint exists leaves an ISO group in the controller that no disconnect clears. It is reported as [bluez/bluez#2496](https://github.com/bluez/bluez/issues/2496), with an HCI trace from boot; add your own trace there if you hit it with another controller or device. `scripts/capture-iso-busy` does the system side:

```sh
echo 'RESET_ON_BOOT=no' >> ~/.config/hearing-aids/devices.conf   # let the bug happen
sudo scripts/capture-iso-busy arm       # btmon from boot, bluetoothd -d
# reboot, log in, wait for the connect service, play a sound
sudo scripts/capture-iso-busy collect   # bundles everything in ~/iso-busy-report-*, restores
```

Then remove the `RESET_ON_BOOT` line. The bundle holds `btmon-boot.snoop`, the bluetoothd, kernel, PipeWire and user journals, versions and controller details. It contains the Bluetooth addresses of your devices and nothing else personal.

## Alternatives

If your aids only support ASHA (Android's pre-LE-Audio protocol) and not LE Audio, look at [asha_pipewire_sink](https://github.com/thewierdnut/asha_pipewire_sink). Do not run it with `Experimental = true` in BlueZ: the two ASHA implementations are incompatible. Our Vivia 960 also work through it, but LE Audio gives a better codec and needs nothing outside the distribution.

## Repository layout

```
extension/            GNOME Shell extension (metadata.json, extension.js, icons/)
scripts/              connect-hearing-aids, check (CI), capture-iso-busy (upstream report)
bench/                login-time (login → sound timing from the journal), baseline, journal
systemd/user/         hearing-aids-connect.service
bluetooth/            main.conf snippet, bluetoothd override, WirePlumber suspend config, polkit rule
po/                   translations (French so far)
docs/                 verified hearing aids and Bluetooth controllers, screenshot
install.sh            installs the user-side pieces
```

## Changelog

### v1.3.16 — A time budget instead of a systemd kill (2026-09-15)

- `connect-hearing-aids` gives up on its own rather than starting a recovery step it cannot finish. With both aids away it now stops after about 80 s instead of 172 s, and on 2026-09-14 the same situation ran into the unit's 180 s timeout and was killed mid-reset.
- `TimeoutStartSec` raised to 300 s so systemd never interrupts an adapter reset. `BUDGET_SECONDS` in `devices.conf` or the environment tunes when the script gives up (120 s by default).

### v1.3.15 — Say what is really connected (2026-09-15)

- `connect-hearing-aids` stops when neither aid is connected instead of resetting the adapter twice for nothing: with both aids in the charger it used to report "BAP profile active", fail the stream check and cut Bluetooth twice on the way.
- The success line now says how many ears carry the stream. One silent aid, the state BlueZ leaves behind after a botched reconnection, used to be reported as a full success.
- The WirePlumber restart in the last-resort path is bounded by a timeout.

### v1.3.14 — The adapter never stays off (2026-09-15)

- `connect-hearing-aids` powers the Bluetooth adapter back on if anything stops it mid-reset: the systemd start timeout, Ctrl+C, the session ending. Until now such an interruption left Bluetooth off, keyboard and mouse included, until someone turned it back on by hand. It happened once, on 2026-09-14.
- The once-per-boot marker is written after the reset has run, not before, so an interrupted reset is retried on the next run instead of being skipped.

### v1.3.13 — README accuracy pass (2026-09-15)

- The polkit paragraph no longer splits the two paragraphs describing the `vcp` plugin override.
- Corrected: the stream probe plays a few seconds of silence, not one; `devices.conf` documents `RESET_ON_BOOT`; the last-resort bluetoothd restart is automatic when the polkit rule is installed; tested kernels are 7.1 and 7.2.

### v1.3.12 — Drop the GDM WirePlumber config (2026-09-15)

- Removed `bluetooth/gdm-no-bluetooth.conf` and its installation step. On Fedora 44 with GDM 50 the login screen runs as a transient `gdm-greeter` account, not as `gdm`, so a file under `/var/lib/gdm` is never read; the greeter kept registering its LE Audio endpoints with it installed. It was not needed either: the greeter's WirePlumber is not what causes the `Device or resource busy` after boot. If you installed it, `sudo rm -r /var/lib/gdm/.config/wireplumber` cleans up.

### v1.3.11 — bluetoothd restart as a last resort (2026-09-15)

- Optional polkit rule (`bluetooth/50-hearing-aids-bluetooth.rules`) letting your user restart `bluetooth.service` without a password. With it installed, `connect-hearing-aids` clears BlueZ's stale-connection state by itself: restart bluetoothd, restart WirePlumber, reconnect.

### v1.3.10 — No more disconnect/reconnect fallback (2026-09-15)

- When the BAP profile does not come up, `connect-hearing-aids` resets the adapter instead of disconnecting and reconnecting the aids: with BlueZ 5.87 the reconnection regularly leaves one aid connected without any profile ("No matching connection for device"), silent and invisible to the extension until bluetoothd is restarted.
- The stream probe now checks that both BAP transports are active during playback, so a silent ear is reported instead of "stream established".
- Troubleshooting: the bluetoothd restart must be followed by a WirePlumber restart.

### v1.3.9 — Faster adapter reset (2026-09-09)

- The reset on the first run after boot no longer sleeps 3 s then 4 s: the script waits for the adapter to report powered off, then on, then for the aids to reconnect on their own (6 s at most) before issuing `connect`. Measured on 10 interleaved runs: 12.2 s down to 7.8 s for the reset path, no failure.

### v1.3.8 — Connect as soon as WirePlumber is ready (2026-09-09)

- The user service no longer sleeps 8 s before connecting: the script waits for WirePlumber's LE Audio endpoints to show up in BlueZ (`Media1.SupportedUUIDs`), which takes under a second after WirePlumber starts. Measured 8.7 s of fixed wait on the three previous boots.
- `bench/login-time` prints the login → sound timing of the last boots from the journal, phase by phase.

### v1.3.7 — Optional WirePlumber rule against the resume delay (2026-09-05)

- `bluetooth/wireplumber-suspend.conf.example`: keeps the LE Audio stream open for 300 s of silence instead of 5, so sound starts with the video instead of a second later. Optional, costs battery; documented in Using it.

### v1.3.6 — Capture script for the upstream report (2026-09-05)

- `scripts/capture-iso-busy` (root) arms an HCI trace from boot and bluetoothd in debug, then collects journals, versions and controller details into one folder and restores the system.
- `RESET_ON_BOOT=no` in `devices.conf` disables the adapter reset on the first run after boot, to let the bug reproduce for the capture.

### v1.3.5 — Adapter reset on the first run after boot (2026-09-05)

- `connect-hearing-aids` resets the adapter once per boot before connecting, instead of connecting, failing the stream check and resetting then. The aids were reconnecting to bluetoothd before the session's WirePlumber existed, and that first connection is what left the stale ISO group behind. Login path shortened by about 20 s, and no more "busy" on the first stream.

### v1.3.4 — Stream probe ignores errors from before the adapter reset (2026-09-05)

- After a power cycle, `connect-hearing-aids` reported "still failing" because its 35 s look-back into the journal caught the very error that triggered the reset. The probe now starts at the reset when one happened.

### v1.3.3 — Keep the login screen's WirePlumber off Bluetooth (2026-09-05)

- New `bluetooth/gdm-no-bluetooth.conf`, to install for the `gdm` user: the greeter's WirePlumber was negotiating LE Audio with the aids before the user session and leaving a stale ISO group in the controller, the root cause of "Device or resource busy" after every reboot. With it in place the adapter power cycle should no longer be needed.

### v1.3.2 — Stream probe catches the 30 s retry cycle (2026-09-05)

- `connect-hearing-aids` reported "stream established" while bluetoothd kept logging `Device or resource busy` every 30 s: when audio is already playing, the ISO connect is retried on a 30 s cycle and a 4 s probe missed it. The probe now also looks at the previous 35 s of the journal.

### v1.3.1 — Left and right stay labelled (2026-09-05)

- Battery and volume rows showed the Bluetooth aliases ("Vivia R", "Vivia") instead of Left/Right when the aids reconnected: the side comes from the BAP endpoint, which BlueZ creates a moment after the battery and volume characteristics, and the labels were frozen at first sight. They now follow every rescan.

### v1.3.0 — Audit follow-up: checks, cleanup, faster connect (2026-09-05)

- The program list is re-read every time the menu opens, after one aid answered a read with a single program and the menu stayed wrong for an hour. Control point frames are logged at debug level to diagnose the next occurrence.
- Volume writes refused by the aid are retried once with a freshly read change counter before blaming the bluetoothd plugin.
- The extension releases every timer on disable and no longer embeds the screenshot helper.
- `connect-hearing-aids` polls for the BAP profile instead of sleeping: about 4 s instead of 10 s when the aids are already connected. It finds the device path on any adapter (no more `hci0` assumption) and says so when it cannot read the system journal instead of silently passing the stream check.
- `install.sh` requires `gettext` (the compiled French catalog is no longer versioned, it had drifted behind the source) and enables the extension through `gnome-extensions`.
- `scripts/check` and a GitHub Actions workflow run the static checks: JS syntax, shellcheck, translation catalogs against the code.

### v1.2.1 — Stream check in the connect script (2026-09-05)

- `connect-hearing-aids` now probes the stream after connecting and resets the adapter when the ISO connection fails with "busy" or "timed out", a state seen after a reboot that no reconnect could clear.
- It also detects the pair showing up as two sinks instead of one coordinated set.

### v1.2.0 — Battery levels and per-ear volume (2026-09-04)

- Battery level of each ear in the menu, with the usual battery icons, read from the aids' Battery Level characteristic.
- One volume slider per ear, driving the aids' own volume through the Volume Control Service. Requires bluetoothd with `--noplugin=vcp`: BlueZ's plugin otherwise claims the service and forces both ears to the same volume.
- Left and right are identified from the BAP endpoint locations.

### v1.1.0 — Model name in the menu, translations (2026-09-04)

- The menu header shows manufacturer and model ("ReSound Vivia 960") instead of the Bluetooth alias of whichever aid is driven.
- Menu strings translated through gettext; French included.
- Removed the microphone switch: the LE Audio microphone mute only affects the microphone feed sent to the computer, which PipeWire does not even expose for these aids. This also removes the `--noplugin=micp` bluetoothd override from the setup.
- Lists of verified hearing aids and Bluetooth controllers in `docs/`.

### v1.0.0 — First release (2026-09-04)

- GNOME 50 extension: program list and switching through the Hearing Access Service, microphone mute through the Microphone Control Service, indicator shown only while an aid is connected.
- `connect-hearing-aids` script with BAP profile check and clean reconnect, plus a user service to run it at login.
- Setup notes for LE Audio on BlueZ 5.87 / PipeWire 1.6.8, tested with ReSound Vivia 960.
