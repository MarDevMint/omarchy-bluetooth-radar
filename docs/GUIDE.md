# Radar — full guide

A radar in your Omarchy bar for the Bluetooth devices and Wi-Fi networks around
you. Open it, and phones, watches, earbuds, trackers, TVs, printers and routers
appear as their icons, nearest to the centre. It reads what devices announce
(AirPods batteries, Windows laptop vs desktop, thermometer readings), shows
who is getting closer, helps you find a lost device by walking hot/cold, and
can warn you about a tracker following you or camera glasses nearby.

It only listens. It never connects to anything, never writes what it hears to
disk, and puts Bluetooth back the way it found it.

## What it can and can't tell you

- **Distance is rough.** It is estimated from signal strength, which walls,
  bodies and each device's transmit power distort. Expect "about 3 m", not
  "3.2 m". Calibrate a device (below) to tighten it.
- **Direction is not real.** One antenna can't tell where a signal comes from.
  Each device keeps a fixed, made-up angle; only its distance from the centre
  means something.
- **Paired devices go quiet.** Once a device is connected to something else
  (a watch to its phone), it stops advertising and can't be heard.
- **Phones change address** every 8–15 minutes. The radar follows the change
  when only one device fits (same kind, maker, model, similar signal); two
  look-alikes side by side may still show up twice.
- **Your Bluetooth chip filters repeats** within one scan, so the helper
  restarts the scan every 3 s: a device that is here is heard every ~3 s
  (90 % within 7 s) and one that left disappears after 12 s — no lingering
  ghosts. Find mode restarts every second, for somewhat more readings of the
  device you follow (~1.5× measured).
- **Classic Bluetooth** devices (older speakers, car kits) show up only while
  they are discoverable.

## Install

```bash
omarchy plugin add https://github.com/MarDevMint/omarchy-bluetooth-radar
omarchy plugin enable m.radar
```

Left-click the bar icon to open the radar, right-click to start or stop
scanning. Bind a key if you like:

```lua
o.bind("SUPER + ALT + R", "Radar", "omarchy-shell shell toggle m.radar '{}'")
```

Scripting: `omarchy-shell m.radar scanOn | scanOff | scanToggle | status | show`,
`omarchy-shell m.radar find "galaxy watch"` (find mode on the strongest match),
`findStop`, `guardToggle`, `proximityArm "my watch"`, `proximityOff`,
`proximityStatus`. Clicking an icon on the radar picks that device.

## Keys in the radar

| Key | Does |
| --- | --- |
| `S` / `Enter` | start or stop scanning |
| `↑` `↓` | pick a device or network |
| `L` | find the picked device: hot/cold meter, faster scan |
| `M` | Geiger clicks while finding |
| `⇧C` | calibrate: the picked device is 1 m away right now |
| `⇧R` | reset that kind of device's calibration |
| `⇧K` | proximity lock: lock the screen when the picked device leaves |
| `W` | show or hide Wi-Fi networks |
| `B` | listen for classic Bluetooth devices too |
| `F` | only show devices within 10 m, 3 m, or all |
| `U` | hide devices that can't be identified |
| `⇧G` | Guard: tracker and camera-glasses alerts |

Keys that change something lasting need Shift, so a stray letter typed while
the popout has focus can't arm a lock or rewrite a calibration.
| `Esc` | clear the pick, then close |

**Calibrating** teaches the radar how loud a kind of device is at one metre.
Hold a phone 1 m from the laptop, pick it, press `C`; every phone then uses it.
It is refused if the signal is too weak or too strong to be 1 m away, and
older calibrations outside that range are ignored.

**Finding** a device: pick it, press `L`, then turn slowly in a full circle,
pausing every 45°. Your body blocks the signal, so the bar is fullest facing
the device; walk that way. A watch connected to its phone barely advertises:
switch the phone's Bluetooth off first. The arrow next to a distance says
where it is heading: `↓` getting closer, `↑` moving away.

**Proximity lock** locks the screen when the device you carry has been gone
(or 12 dB weaker than when you armed it) for 20 s *and* the laptop has been
idle 10 s, after a 5 s notification you cancel by touching mouse or keys. It
never unlocks, and pauses when scanning can't run. Arm it with the device
next to you. It needs a device with a fixed identity: a public address (many
watches) or one paired with the laptop, since phones otherwise change
address. Only a salted hash of that one device's address is stored. While
armed the radio listens continuously. Idle Android phones often stop
advertising; a watch is more dependable.

**Guard** scans 20 s every 2 minutes while the radar is off. It notifies when
a tracker that says it is away from its owner (AirTag, SmartTag, Tile,
Chipolo, Google Find Hub tags) has been seen 3+ times over 30+ minutes — the
time-only version of AirGuard's rule — and when likely camera glasses
(Ray-Ban/Oakley Meta and others) come within ~5 m. Glasses mostly advertise
when switched on or pairing, so no alert never means no glasses.

## Settings

Set in the widget's entry in `shell.json`, or with `omarchy bar set m.radar <key> <value>`.

| Key | Default | |
| --- | --- | --- |
| `autoStopMinutes` | `5` | stop scanning after this long; `0` never |
| `maxRangeMeters` | `10` | distance at the outer ring |
| `classicScan` | `true` | also listen for classic Bluetooth |
| `showWifi` | `true` | show Wi-Fi networks |
| `rangeFilter` | `0` | only show devices within this many metres; `0` all (`F`) |
| `hideUnknown` | `false` | hide unidentified devices (`U`) |
| `guard` | `false` | tracker and glasses alerts (`⇧G`) |
| `proximity` | `null` | the device proximity lock follows (`⇧K`) |
| `calibration` | `{}` | per-kind 1 m signal, written by `C` |

Scanning shares the radio with Bluetooth audio and can make it stutter; the
radar says so when an audio device is connected.

## How it works

```
bin/m-radar-scan   BlueZ over D-Bus → one JSON snapshot per second
bin/m-radar-wifi   NetworkManager (nmcli) → networks, once per call
Service.qml        one shared scanner for every monitor's bar
Model.js           pure logic: filtering, distance, trend, identity, find,
                   guard, address-change linking, rows
Decode.js          reads advert payloads byte by byte (models, batteries,
                   sensors, trackers, glasses)
Vendors.js         lookup tables: companies, services, classes, kinds
Radar.qml          the scope        FindMeter.qml   find mode's meter
KeyButton.qml      labelled key button
BarWidget.qml      bar icon and popout
```

Everything that decides something lives in `Model.js` / `Decode.js` and has
tests: `node test/model.test.js`.

Signal handling: BlueZ only reports an RSSI change of 8 dB or more unless
the discovery filter sets an RSSI, so the helper sets `RSSI: -127` (drops
nothing) and reports, per second, the median of every reading. The model runs
those through an outlier test and a Kalman filter before turning signal into
metres, and fades a device out as it goes quiet instead of keeping a stale
reading. Bluetooth turned off the Omarchy way (an rfkill block) is lifted for
the scan and put back after.

## Privacy

- Addresses are replaced by a per-session salted hash inside the helper; the
  real ones never reach the shell. Nothing is saved; Guard's sightings live
  in memory for two hours at most.
- The only thing stored is what you set: settings and calibration, in `shell.json`.
- Passive listening to public broadcasts only. Use it as a curiosity, not to
  follow people.

## Requirements

Omarchy with BlueZ, NetworkManager, Python 3 with `python-dbus` and
`python-gobject` (all present on a stock install). Wi-Fi maker names use
`/usr/share/hwdata/oui.txt` when available.

## Credits

Lookup tables follow the Bluetooth SIG assigned numbers. Payload layouts come
from public documentation and research, used as facts only: furiousMAC's
Continuity docs and Theengs (Apple), [MS-CDP] (Microsoft), Google's Fast Pair
and Find Hub specs, bthome.io, Ruuvi's format 5, govee-ble and ble_monitor,
seemoo-lab's AirGuard and the IETF DULT draft (trackers), the Samsung Offline
Finding paper (Yu et al., USENIX Security 2024), and the Ban-Rays / Nearby
Glasses projects (camera glasses). The radar-scope idea and the hashed-angle
trick are common to Fieldwatch and android-network-survey, which were studied
for ideas only; no code was copied.

## License

MIT, see `LICENSE`.
