# Bluetooth controllers

LE Audio needs a controller that can act as **CIS central** (Connected Isochronous Stream). Bluetooth 5.2 is the minimum on paper, but the vendor firmware decides. The only reliable test on Linux:

```sh
sudo btmgmt info
```

Look at the `supported settings` line of your adapter. It must contain `cis-central`. If it does not, the controller cannot stream LE Audio, whatever the box or the chip's Bluetooth version says. BlueZ will then only offer the ASHA profile for hearing aids.

Useful extras on the same line: `cis-peripheral`, `iso-broadcaster` (Auracast transmit), `sync-receiver` (Auracast receive), `wide-band-speech`.

## Verified

| Controller | Bus / ID | Chipset | `cis-central` | LE Audio to hearing aids | Notes |
|---|---|---|---|---|---|
| Intel AX211 | PCIe / USB 8087:0033 | Intel | yes | **works** (ReSound Vivia 960, stereo, 2M PHY) | Fedora 44, kernel 7.1.13, BlueZ 5.87, firmware 42-20.25. Occasional light crackle at a few metres. Refuses `LE Create CIS` (`Command Disallowed`) after the aids connected before any BAP endpoint existed, until a power cycle: [bluez/bluez#2496](https://github.com/bluez/bluez/issues/2496). |
| UGREEN "BT 5.4 Adapter" | USB 33fa:0010 | Actions Semiconductor (manufacturer id 2279) | **no** | no | Bluetooth 5.4 on the box, no ISO support in firmware. Classic and BLE only. |

## Reported elsewhere, not verified here

These come from ASHA users of [asha_pipewire_sink](https://github.com/thewierdnut/asha_pipewire_sink/issues/42), so they say something about link quality with hearing aids, not about LE Audio support:

| Controller | Reported |
|---|---|
| Intel AX200 / AX210 | Works, quality varies between units; `cis-central` expected on AX210 |
| Qualcomm QCNCM865 (Wi-Fi 7) | Best link stability of the set, LE Audio capable controller |
| MediaTek MT7925 | Some packet drops |

## How to report

Open an issue titled `Controller: <model>` with:

```sh
lsusb            # or lspci -nn for M.2 cards
sudo btmgmt info
uname -r
bluetoothctl --version
```

and whether audio reached your aids (`pactl list cards` showing `Active Profile: bap-sink` is the proof). One line per adapter is enough.
