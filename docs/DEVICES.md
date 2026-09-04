# Hearing aids

Status meanings:

- **verified**: someone streamed audio and switched programs with this repository's tools, and reported the details below.
- **expected**: same hardware platform as a verified device, sold under another brand, or the manufacturer documents LE Audio support. Not tried.

Manufacturer claims are not enough to move a device to *verified*: some "LE Audio ready" aids ship the feature disabled until a firmware update by the audiologist.

## Verified

| Device | Brand / platform | Programs (HAS) | Preset sync | Mic mute (MICS) | Stereo | Reported on | Notes |
|---|---|---|---|---|---|---|---|
| ReSound Vivia 960 (pair) | GN Hearing | 4 (Universal, Noise, Outdoor, Universal(1)) | yes, `0x08` required, `0x05` refused with ATT 0x80 | accepted, only affects the mic feed sent to the PC | yes, one sink, right grouped via CSIS | Fedora 44, BlueZ 5.87, PipeWire 1.6.8, GNOME 50, Intel AX211 | LC3 16 kHz per ear, 7.5 ms frames, 2M PHY, 5 retransmissions. Also supports ASHA and the 24 kHz LC3 configuration. |

## Expected

| Device | Why |
|---|---|
| ReSound Vivia (other sizes), ReSound Nexia, ReSound Savi | Same GN platform and firmware family as the Vivia 960 |
| Jabra Enhance Pro 20, Jabra Enhance Select 500 | GN Hearing platform under the Jabra brand |
| Beltone Serene, Beltone Envision | GN Hearing platform under the Beltone brand |
| Oticon Intent | Manufacturer lists LE Audio and Auracast |
| Phonak Audéo Infinio, Audéo Sphere Infinio, Unitron Vivante | Sonova platform, manufacturer lists LE Audio |
| Starkey Genesis AI, Edge AI | Manufacturer lists LE Audio |
| Signia Integrated Xperience (IX), Rexton Reach | WSA platform, manufacturer lists LE Audio and Auracast |
| Widex Allure | Manufacturer lists LE Audio |
| Cochlear Nucleus 8 | Sound processor, manufacturer lists LE Audio and Auracast |

Aids that only support ASHA (Android streaming before LE Audio) are out of scope here: see [asha_pipewire_sink](https://github.com/thewierdnut/asha_pipewire_sink).

## How to check yours

With the aids paired and connected:

```sh
bluetoothctl info <MAC>
```

LE Audio aids list at least `Audio Stream Control (184e)`, `Published Audio Capabilities (1850)` and `Common Audio (1853)`. `Hearing Aid (1854)` is the program service the extension uses; `Microphone Control (184d)` and `Volume Control (1844)` are optional extras. `Google Inc. (fdf0)` means ASHA is also available.

## How to report

Open an issue titled `Device: <brand> <model>` with:

- the output of `bluetoothctl info <MAC>` for one aid (UUID list),
- the program list shown by the extension, or `journalctl --user -g hearing-aid-presets`,
- whether switching programs changed both ears,
- `pactl list cards` (the `bluez_card` entries) and the sink format from `pactl list sinks short`,
- distribution, kernel, BlueZ, PipeWire and GNOME versions, controller model.

Devices move to *verified* once a report includes streaming and program switching.
