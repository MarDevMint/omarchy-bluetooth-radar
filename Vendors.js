.pragma library

// Lookup tables for telling devices apart from what they advertise. Kept
// small on purpose: the companies and services you actually meet around a
// home or a café, not the full registries.
//
// Sources: Bluetooth SIG Assigned Numbers (company identifiers, 16-bit
// UUIDs, appearance values) and public write-ups of Apple's Continuity
// protocol. Numbers are decimal company ids / lowercase 16-bit UUIDs.

// Company id → name, plus the kind of device it usually means when nothing
// more specific is known ("" = could be anything that company makes).
var COMPANIES = {
  0: ["Ericsson", ""],
  2: ["Intel", "computer"],
  6: ["Microsoft", "computer"],
  10: ["Qualcomm", ""],
  13: ["Texas Instruments", ""],
  15: ["Broadcom", ""],
  29: ["Qualcomm", ""],
  48: ["STMicroelectronics", ""],
  64: ["Epson", "printer"],
  70: ["MediaTek", ""],
  76: ["Apple", ""],
  87: ["Harman", "audio"],
  89: ["Nordic Semiconductor", ""],
  93: ["Realtek", ""],
  103: ["Jabra", "audio"],
  107: ["Polar", "watch"],
  117: ["Samsung", ""],
  120: ["Nike", "fitness"],
  135: ["Garmin", "watch"],
  158: ["Bose", "audio"],
  159: ["Suunto", "watch"],
  196: ["LG", "tv"],
  224: ["Google", ""],
  301: ["Sony", ""],
  343: ["Amazfit", "watch"],
  369: ["Amazon", "speaker"],
  474: ["Logitech", "input"],
  427: ["Meta", ""],
  637: ["Huawei", ""],
  741: ["Espressif", "iot"],
  911: ["Xiaomi", ""],
  962: ["Snap", ""],
  1422: ["Meta", ""],
  1660: ["Tile", "tracker"],
  2243: ["Chipolo", "tracker"],
  3411: ["Luxottica", "glasses"],
  1177: ["Ruuvi", "sensor"]
}

// Apple Continuity: the first byte of Apple's manufacturer data says which
// feature is talking, which hints at the device behind it.
var APPLE = {
  1: ["Background app", "phone"],
  2: ["iBeacon", "beacon"],
  3: ["AirPrint", "printer"],
  5: ["AirDrop", "phone"],
  6: ["HomeKit", "iot"],
  7: ["AirPods / Beats", "audio"],
  8: ["Hey Siri", "phone"],
  9: ["AirPlay target", "tv"],
  10: ["AirPlay source", "phone"],
  11: ["Apple Watch", "watch"],
  12: ["Handoff", "phone"],
  13: ["Hotspot", "phone"],
  14: ["Hotspot", "phone"],
  15: ["Nearby action", "phone"],
  16: ["Nearby info", "phone"],
  18: ["Find My", "tracker"]
}

// 16-bit service UUIDs worth naming: [name, kind, maker].
var SERVICES = {
  "180d": ["Heart rate", "fitness", ""],
  "180f": ["Battery", "", ""],
  "1812": ["Keyboard / mouse", "input", ""],
  "fa25": ["Pebblebee", "tracker", "Pebblebee"],
  "fcb2": ["Tracker network", "tracker", ""],
  "fcd2": ["BTHome", "sensor", ""],
  "fd5a": ["SmartTag", "tracker", "Samsung"],
  "fd5f": ["Meta device", "", "Meta"],
  "fd69": ["Samsung Find", "", "Samsung"],
  "fd84": ["Tile", "tracker", "Tile"],
  "fd6f": ["Exposure Notification", "phone", ""],
  "fe03": ["Alexa", "speaker", "Amazon"],
  "fe07": ["Sonos", "speaker", "Sonos"],
  "fe1f": ["Garmin", "watch", "Garmin"],
  "fe2c": ["Fast Pair", "", "Google"],
  "fe33": ["Chipolo", "tracker", "Chipolo"],
  "fe45": ["Snap", "", "Snap"],
  "fe78": ["HP", "printer", "HP"],
  "fe95": ["Xiaomi", "", "Xiaomi"],
  "fe9f": ["Google services", "", "Google"],
  "feaa": ["Eddystone beacon", "beacon", "Google"],
  "febe": ["Bose", "audio", "Bose"],
  "feec": ["Tile", "tracker", "Tile"],
  "feed": ["Tile", "tracker", "Tile"],
  "fef3": ["Nearby", "phone", "Google"]
}

// Appearance category (appearance >> 6) → kind.
var APPEARANCE = {
  1: "phone",
  2: "computer",
  3: "watch",
  5: "tv",
  8: "tracker",
  9: "tracker",
  10: "audio",
  13: "fitness",
  15: "input",
  17: "fitness",
  18: "fitness",
  33: "audio"
}

// Classic Bluetooth "class of device" (Device1.Class): bits 8–12 are the
// major class, bits 2–7 the minor. Major class → [kind, label].
var CLASS_MAJOR = {
  1: ["computer", ""],
  2: ["phone", ""],
  3: ["router", "Network access point"],
  4: ["audio", ""],
  5: ["input", ""],
  6: ["printer", ""],
  7: ["watch", "Wearable"],
  8: ["gamepad", "Toy"],
  9: ["fitness", "Health"]
}

// Audio/video minor class → [kind, label]; wins over the major class's kind.
var CLASS_AUDIO = {
  1: ["audio", "Headset"],
  2: ["audio", "Hands-free"],
  4: ["audio", "Microphone"],
  5: ["speaker", "Loudspeaker"],
  6: ["audio", "Headphones"],
  7: ["audio", "Portable audio"],
  8: ["audio", "Car audio"],
  9: ["tv", "Set-top box"],
  10: ["speaker", "Hi-fi audio"],
  12: ["camera", "Video camera"],
  14: ["tv", "Video monitor"],
  15: ["tv", "Display and speaker"],
  16: ["tv", "Video conferencing"],
  18: ["gamepad", "Gaming"]
}

// Wearable minor class → label.
var CLASS_WEARABLE = { 1: "Wristwatch", 2: "Pager", 3: "Jacket", 4: "Helmet", 5: "Glasses" }

// BlueZ's own guess (Device1.Icon) → kind.
var BLUEZ_ICONS = {
  "phone": "phone",
  "computer": "computer",
  "audio-card": "audio",
  "audio-headset": "audio",
  "audio-headphones": "audio",
  "input-keyboard": "input",
  "input-mouse": "input",
  "input-gaming": "gamepad",
  "input-tablet": "input",
  "printer": "printer",
  "video-display": "tv",
  "multimedia-player": "audio",
  "camera-video": "camera"
}

// Name fragments that give a device away (lowercase, tested in order).
var NAME_HINTS = [
  [/watch|band|fit|amazfit|garmin/, "watch"],
  [/buds|pods|headphone|headset|earbud|beats|jbl|wh-|wf-|soundcore/, "audio"],
  [/speaker|soundbar|echo|sonos|homepod/, "speaker"],
  [/\btv\b|bravia|\[tv\]|roku|chromecast|fire ?tv/, "tv"],
  [/dualsense|dualshock|controller|xbox|joy-con|gamepad/, "gamepad"],
  [/keyboard|keys|mouse|mx /, "input"],
  [/printer|deskjet|laserjet|officejet|series$/, "printer"],
  [/macbook|laptop|thinkpad|surface|\bpc\b|desktop/, "computer"],
  [/iphone|galaxy|pixel|redmi|phone/, "phone"],
  [/tag|tile|airtag/, "tracker"],
  [/bulb|lamp|light|hue/, "light"],
  [/car|tesla|bmw|audi|ford/, "car"]
]

// Kind → [label, Nerd Font glyph, typical RSSI at 1 m in dBm].
// The last column is a starting guess per kind: wearables and trackers
// whisper to save battery, mains-powered things shout. Calibrating a device
// (C in the popout) overrides it for that kind.
var KINDS = {
  phone: ["Phone", "󰄜", -62],
  computer: ["Computer", "󰌢", -58],
  watch: ["Watch", "󰖉", -68],
  audio: ["Audio", "󰋋", -63],
  speaker: ["Speaker", "󰓃", -58],
  tv: ["TV / display", "󰔂", -56],
  tracker: ["Tracker", "󰓹", -66],
  beacon: ["Beacon", "󰀃", -62],
  printer: ["Printer", "󰐪", -56],
  gamepad: ["Game controller", "󰊴", -60],
  input: ["Keyboard / mouse", "󰌌", -62],
  fitness: ["Fitness", "󰋑", -68],
  sensor: ["Sensor", "󰔏", -66],
  light: ["Light", "󰌵", -60],
  car: ["Car", "󰄋", -56],
  camera: ["Camera", "󰄀", -60],
  glasses: ["Smart glasses", "󰊪", -62],
  iot: ["Smart device", "󰟐", -62],
  router: ["Wi-Fi network", "󰖩", -35],
  unknown: ["Device", "󰂯", -60]
}
