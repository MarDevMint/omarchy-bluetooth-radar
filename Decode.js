.pragma library

// Reads what devices say in their adverts, byte by byte: AirPods batteries,
// what kind of Windows machine is announcing itself, sensor readings, and
// whether a tracker is away from its owner. Pure functions over the hex the
// helper forwards, like Model.js, so it can be tested with node.
//
// Offsets count from the first byte after the company id (manufacturer data)
// or after the UUID (service data), which is how BlueZ hands them over.
//
// Sources (facts only, nothing copied): furiousMAC/continuity and Theengs for
// Apple Continuity, [MS-CDP] for Microsoft's beacon, Google's Fast Pair and
// Find Hub specs, bthome.io, Ruuvi's format 5 doc, govee-ble and ble_monitor
// for Govee and Xiaomi, seemoo-lab/AirGuard and the IETF DULT draft for
// trackers, and the Ban-Rays / Nearby Glasses projects for camera glasses.

function bytes(hex) {
  var out = []
  hex = String(hex || "")
  for (var i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16))
  return out
}

function u16le(b, i) { return b[i] | (b[i + 1] << 8) }
function s16le(b, i) { var v = u16le(b, i); return v & 0x8000 ? v - 0x10000 : v }
function u16be(b, i) { return (b[i] << 8) | b[i + 1] }
function s16be(b, i) { var v = u16be(b, i); return v & 0x8000 ? v - 0x10000 : v }
function u24le(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) }
function hex2(n) { return ("0" + n.toString(16)).slice(-2) }

// ---------------------------------------------------------------- Apple

// Proximity Pairing model, as the two bytes appear on air.
var AIRPODS = {
  "0220": "AirPods", "0f20": "AirPods 2", "1320": "AirPods 3",
  "0e20": "AirPods Pro", "1420": "AirPods Pro 2", "2420": "AirPods Pro 2 (USB-C)",
  "0a20": "AirPods Max", "0b20": "Powerbeats Pro", "1220": "Beats Fit Pro",
  "0320": "Powerbeats3", "0520": "BeatsX", "0620": "Beats Solo3"
}

// Nearby Info action code (low nibble of the first byte) → what the owner is doing.
var NEARBY_ACTIVITY = {
  3: "Idle", 5: "Playing audio", 7: "Screen on", 9: "Watching video",
  10: "Watch on wrist", 11: "In use", 13: "Driving", 14: "On a call"
}

// Find My device class, bits 4–5 of the status byte.
var FINDMY_CLASS = ["Apple device", "AirTag", "Find My accessory", "AirPods"]

function battery10(nibble) { return nibble <= 10 ? nibble * 10 : -1 }

// Apple's manufacturer data is a run of type/length/value messages.
function apple(b, out) {
  for (var i = 0; i + 2 <= b.length;) {
    var type = b[i], len = b[i + 1], v = b.slice(i + 2, i + 2 + len)
    i += 2 + len
    if (v.length < len) break
    if (type === 0x07 && v.length >= 9) {
      var model = hex2(v[1]) + hex2(v[2])
      out.kind = "audio"
      out.model = AIRPODS[model] || "AirPods / Beats"
      if (model !== "0a20") {
        // Bit 5 of the status byte says which bud is the primary one.
        var flip = (v[3] & 0x20) !== 0
        var hi = v[4] >> 4, lo = v[4] & 0x0f
        var charging = v[5] >> 4
        out.battery = {
          left: battery10(flip ? lo : hi), right: battery10(flip ? hi : lo),
          case: battery10(v[5] & 0x0f),
          charging: { left: !!(charging & (flip ? 2 : 1)), right: !!(charging & (flip ? 1 : 2)), case: !!(charging & 4) }
        }
      }
    } else if (type === 0x10 && v.length >= 2) {
      var action = v[0] & 0x0f
      if (NEARBY_ACTIVITY[action]) out.activity = NEARBY_ACTIVITY[action]
      if (action === 10) { out.kind = out.kind || "watch"; out.model = out.model || "Apple Watch" }
      else if (v[1] === 0x98) { out.kind = out.kind || "watch"; out.model = out.model || "Apple Watch" }
      else if (v[1] === 0x14 || v[1] === 0x09) { out.kind = out.kind || "computer"; out.model = out.model || "Mac" }
    } else if (type === 0x12 && v.length >= 1) {
      // len 0x19 = separated from its owner (full key); 0x02 = owner nearby.
      // Every iPhone, Mac and AirPods sends this too: only AirTags and
      // third-party accessories are trackers in the "could follow you" sense.
      var cls = (v[0] & 0x30) >> 4
      out.tracker = { network: "Apple Find My", separated: len === 0x19, what: FINDMY_CLASS[cls] }
      if (cls === 1 || cls === 2) { out.kind = "tracker"; out.model = out.model || FINDMY_CLASS[cls] }
      else if (cls === 3) out.kind = out.kind || "audio"
      else out.kind = out.kind || "phone"
    }
  }
}

// -------------------------------------------------------------- Microsoft

var WINDOWS_TYPES = {
  1: ["gamepad", "Xbox One"], 6: ["phone", "iPhone"], 7: ["phone", "iPad"],
  8: ["phone", "Android phone"], 9: ["computer", "Windows desktop"],
  11: ["phone", "Windows phone"], 12: ["computer", "Linux device"],
  13: ["iot", "Windows IoT"], 14: ["tv", "Surface Hub"],
  15: ["computer", "Windows laptop"], 16: ["computer", "Windows tablet"]
}

function microsoft(b, out) {
  if (b[0] === 0x01 && b.length >= 2) {
    var type = WINDOWS_TYPES[b[1] & 0x1f]
    if (type) { out.kind = type[0]; out.model = type[1] }
  } else if (b[0] === 0x03) {
    out.activity = "Ready to pair (Swift Pair)"
  }
}

// ---------------------------------------------------------------- Samsung
//
// Samsung documents none of this, and no byte says "watch" or "phone": the
// frame family gives the device away (community captures: Flipper's
// EasySetup tables, pi-sniffer, adwatch). Treat as best effort.

// Galaxy Watch EasySetup model byte → generation (Flipper's table).
function galaxyWatchModel(id) {
  if (id >= 0x01 && id <= 0x0b) return "Galaxy Watch4"
  if (id === 0x0c || (id >= 0x11 && id <= 0x18) || id === 0xe4 || id === 0xe5) return "Galaxy Watch5"
  if ((id >= 0x1b && id <= 0x20) || id === 0xec || id === 0xef) return "Galaxy Watch6"
  return "Galaxy Watch"
}

function macText(b, i) {
  var parts = []
  for (var k = 0; k < 6; k++) parts.push(hex2(b[i + k]).toUpperCase())
  return parts.join(":")
}

function samsung(b, out) {
  if (b.length >= 11 && b[0] === 0x42 && b[1] === 0x09 && b[2] === 0x81) {
    out.kind = "audio"; out.model = "Galaxy Buds"; out.activity = "Ready to pair"
  } else if (b.length >= 11 && b[0] === 0x42 && b[1] === 0x04) {
    // Wi-Fi capable TVs, soundbars and appliances; bytes 5–10 are its own
    // fixed MAC, which outlives any address rotation.
    out.kind = "tv"; out.model = "Samsung TV / appliance"; out.stableKey = "samsung:" + macText(b, 5)
  } else if (b.length >= 2 && b[0] === 0x02 && b[1] === 0x18) {
    out.kind = "tv"; out.model = "Samsung TV / appliance"
  } else if (b.length >= 4 && b[0] === 0x01 && b[1] === 0x00 && b[2] === 0x02 && b[3] === 0x00) {
    out.kind = "watch"; out.model = b.length > 10 ? galaxyWatchModel(b[10]) : "Galaxy Watch"
  }
}

// Samsung Find offline beacon (0xFD69): a Galaxy phone, tablet or watch that
// has been away from its network ~30 min, or lost. Byte 0 is the op mode.
function samsungFind(b, out) {
  if (b.length < 14) return
  out.tracker = { network: "Samsung Find", separated: true, what: "Galaxy device offline" }
}

// --------------------------------------------------------------- sensors

// Ruuvi format 5: big-endian, temperature ×0.005 °C, humidity ×0.0025 %.
function ruuvi(b, out) {
  if (b[0] !== 0x05 || b.length < 15) return
  var s = {}
  if (u16be(b, 1) !== 0x8000) s.temperature = s16be(b, 1) * 0.005
  if (u16be(b, 3) !== 0xffff) s.humidity = u16be(b, 3) * 0.0025
  if (u16be(b, 5) !== 0xffff) s.pressure = (u16be(b, 5) + 50000) / 100
  var mv = u16be(b, 13) >> 5
  if (mv !== 2047) s.voltage = (mv + 1600) / 1000
  out.kind = "sensor"; out.model = "RuuviTag"; out.sensor = s
}

// Govee H5072/H5075 family: temperature and humidity packed in 3 bytes.
function govee(b, out) {
  if (b.length === 6) {
    var n = (b[1] << 16) | (b[2] << 8) | b[3]
    var neg = (n & 0x800000) !== 0
    n &= 0x7fffff
    out.sensor = { temperature: (neg ? -1 : 1) * Math.floor(n / 1000) / 10, humidity: (n % 1000) / 10, battery: b[4] & 0x7f }
  } else if (b.length === 7) {
    out.sensor = { temperature: s16le(b, 1) / 100, humidity: u16le(b, 3) / 100, battery: b[5] }
  } else return
  out.kind = "sensor"; out.model = "Govee thermometer"
}

// BTHome v2 (0xFCD2): object id, value pairs, little-endian, ascending ids.
var BTHOME = {
  0x00: [1, 0, ""], 0x01: [1, 1, "battery"], 0x02: [2, 0.01, "temperature", true],
  0x03: [2, 0.01, "humidity"], 0x04: [3, 0.01, "pressure"], 0x05: [3, 0.01, "illuminance"],
  0x0c: [2, 0.001, "voltage"], 0x12: [2, 1, "co2"], 0x14: [2, 0.01, "moisture"]
}

function bthome(b, out) {
  if (!b.length || (b[0] & 0x01) || (b[0] >> 5) !== 2) return  // encrypted, or not v2
  var s = {}
  for (var i = 1; i < b.length;) {
    var obj = BTHOME[b[i]]
    if (!obj || i + 1 + obj[0] > b.length) break
    var v = obj[0] === 1 ? b[i + 1] : obj[0] === 2 ? (obj[3] ? s16le(b, i + 1) : u16le(b, i + 1)) : u24le(b, i + 1)
    if (obj[2]) s[obj[2]] = v * obj[1]
    i += 1 + obj[0]
  }
  if (Object.keys(s).length) { out.kind = "sensor"; out.model = out.model || "BTHome sensor"; out.sensor = s }
}

// Xiaomi MiBeacon (0xFE95): readings only when the frame is not encrypted.
var MIBEACON_MODELS = {
  0x01aa: ["Mi thermometer", "sensor"], 0x055b: ["Mi thermometer 2", "sensor"],
  0x045b: ["Mi clock thermometer", "sensor"], 0x0387: ["Mi thermometer clock", "sensor"],
  0x0347: ["Qingping thermometer", "sensor"], 0x0098: ["Mi plant sensor", "sensor"],
  0x07f6: ["Mi night light", "light"], 0x0a8d: ["Aqara motion sensor", "sensor"],
  0x483b: ["Redmi Watch 5 Active", "watch"]  // from a real capture only
}

function mibeacon(b, out) {
  if (b.length < 5) return
  var frame = u16le(b, 0), product = u16le(b, 2)
  if (MIBEACON_MODELS[product]) { out.kind = MIBEACON_MODELS[product][1]; out.model = MIBEACON_MODELS[product][0] }
  // The device's own public MAC, reversed: a stable identity.
  if ((frame & 0x10) && b.length >= 11) {
    var mac = []
    for (var m = 10; m >= 5; m--) mac.push(hex2(b[m]).toUpperCase())
    out.stableKey = "xiaomi:" + mac.join(":")
  }
  if ((frame & 0x08) || !(frame & 0x40)) return  // encrypted, or carries no reading
  var i = 5 + (frame & 0x10 ? 6 : 0)
  if (frame & 0x20) i += (b[i] & 0x20) ? 2 : 1
  if (i + 3 > b.length) return
  var type = u16le(b, i), len = b[i + 2], v = i + 3, s = {}
  if (v + len > b.length) return
  if (type === 0x1004 && len >= 2) s.temperature = s16le(b, v) / 10
  else if (type === 0x1006 && len >= 2) s.humidity = u16le(b, v) / 10
  else if (type === 0x100a && len >= 1) s.battery = b[v]
  else if (type === 0x100d && len >= 4) { s.temperature = s16le(b, v) / 10; s.humidity = u16le(b, v + 2) / 10 }
  if (Object.keys(s).length) { out.kind = "sensor"; out.model = out.model || "Xiaomi sensor"; out.sensor = s }
}

// -------------------------------------------------------------- trackers
//
// A tracker only matters while it is away from its owner: that is when one
// could be following you. Each network marks that state differently.

var SMARTTAG_STATES = { 1: "Recently lost", 2: "Lost", 3: "Lost for a while" }

function smarttag(b, out) {
  if (!b.length || (b[0] & 0xf8) !== 0x10) return
  var state = b[0] & 0x07
  out.kind = "tracker"; out.model = "Galaxy SmartTag"
  out.tracker = { network: "Samsung Find", separated: state >= 2, what: SMARTTAG_STATES[state] || "Near its owner" }
}

function findHub(b, out) {
  if (b[0] !== 0x40 && b[0] !== 0x41) return
  out.tracker = { network: "Google Find Hub", separated: b[0] === 0x41 || (out.flags !== undefined && out.flags === 0x06),
                  what: b[0] === 0x41 ? "Away from its owner" : "Find Hub device" }
  if (out.flags === 0x06) { out.kind = "tracker"; out.model = out.model || "Find Hub tag" }
}

function dult(b, out) {
  if (b.length < 2) return
  out.tracker = { network: b[0] === 0x01 ? "Apple Find My" : "DULT network " + b[0],
                  separated: (b[1] & 0x01) === 0, what: "Tracker" }
  out.kind = "tracker"
}

// ---------------------------------------------------------------- glasses
//
// Camera glasses mostly advertise when switched on, taken out of the case or
// pairing, and fall quiet while in use, so this can only ever say "possibly".

var GLASSES_MAKERS = { 427: "Meta", 1422: "Meta", 3411: "Ray-Ban / Oakley", 962: "Snap", 1550: "Vuzix", 4345: "Even Realities" }

function glasses(device, makers, out) {
  var hasMetaService = (device.uuids || []).indexOf("fd5f") >= 0
  var meta = makers.indexOf(427) >= 0 || makers.indexOf(1422) >= 0
  var luxottica = makers.indexOf(3411) >= 0
  var name = String(device.name || "").toLowerCase()
  var level = ""
  if ((meta || luxottica) && hasMetaService) level = "high"
  else if (luxottica || /ray-?ban|oakley|spectacles|heycyan/.test(name) || makers.indexOf(962) >= 0
           || (device.uuids || []).indexOf("fe45") >= 0) level = "medium"
  else if (makers.indexOf(1550) >= 0 || makers.indexOf(4345) >= 0) level = "medium"
  else if (hasMetaService) level = "low"
  if (!level) return
  var maker = ""
  for (var i = 0; i < makers.length && !maker; i++) maker = GLASSES_MAKERS[makers[i]] || ""
  out.glasses = { level: level, maker: maker || "Meta" }
  if (level !== "low") { out.kind = "glasses"; out.model = out.model || (maker || "Camera") + " glasses" }
}

// --------------------------------------------------------------- entry

var MAKER_DECODERS = { 76: apple, 6: microsoft, 117: samsung, 1177: ruuvi, 60552: govee }
var SERVICE_DECODERS = { "fd5a": smarttag, "fd69": samsungFind, "feaa": findHub, "fcb2": dult, "fcd2": bthome, "fe95": mibeacon }

// Everything decodable about one device from the helper's "mfr" and "svc"
// hex maps. Returns {} when there is nothing; otherwise any of: kind, model,
// activity, battery {left, right, case, charging}, sensor {temperature,
// humidity, …}, tracker {network, separated, what}, glasses {level, maker},
// stableKey (an identity found inside the payload, which survives the
// device changing its address).
function decode(device) {
  var out = {}
  if (device.flags !== undefined) out.flags = Number(device.flags)
  var mfr = device.mfr || {}
  var svc = device.svc || {}
  var makers = Object.keys(mfr).map(Number)
  for (var i = 0; i < makers.length; i++)
    if (MAKER_DECODERS[makers[i]]) MAKER_DECODERS[makers[i]](bytes(mfr[makers[i]]), out)
  // Govee also uses other unregistered ids; its name gives it away.
  if (!out.sensor && /^(gvh|govee_h|ihoment_h)5/i.test(String(device.name || "")))
    for (var g = 0; g < makers.length && !out.sensor; g++) govee(bytes(mfr[makers[g]]), out)
  for (var uuid in svc)
    if (SERVICE_DECODERS[uuid]) SERVICE_DECODERS[uuid](bytes(svc[uuid]), out)
  // Trackers that only need to be recognised: Tile, Chipolo, Pebblebee.
  var uuids = (device.uuids || []).concat(Object.keys(svc))
  if (!out.tracker) {
    if (svc["feed"] && svc["feed"].indexOf("0200") === 0 || uuids.indexOf("feed") >= 0 || uuids.indexOf("feec") >= 0)
      out.tracker = { network: "Tile", separated: true, what: "Tile" }
    else if (uuids.indexOf("fe33") >= 0)
      out.tracker = { network: "Chipolo", separated: !!(bytes(svc["fe33"])[1] & 0x01), what: "Chipolo" }
    else if (uuids.indexOf("fa25") >= 0)
      out.tracker = { network: "Pebblebee", separated: true, what: "Pebblebee" }
    if (out.tracker) { out.kind = "tracker"; out.model = out.model || out.tracker.what }
  }
  if (svc["fe2c"] !== undefined) fastPair(bytes(svc["fe2c"]), out)
  glasses(device, makers, out)
  delete out.flags
  return out
}

// Google Fast Pair (0xFE2C): 3 bytes = model id in pairing mode; otherwise
// account data, which may end in left/right/case battery.
function fastPair(b, out) {
  if (b.length === 3) {
    out.kind = out.kind || "audio"
    out.activity = "Ready to pair (Fast Pair)"
    return
  }
  for (var i = 1; i < b.length;) {
    var len = b[i] >> 4, type = b[i] & 0x0f
    if ((type === 3 || type === 4) && len >= 1 && i + len < b.length) {
      var level = function(x) { return x === undefined || (x & 0x7f) === 0x7f ? -1 : x & 0x7f }
      var charging = function(x) { return x !== undefined && (x & 0x80) !== 0 }
      // L says how many values follow: left, then right, then case.
      var at = function(k) { return k < len ? b[i + 1 + k] : undefined }
      out.battery = { left: level(at(0)), right: level(at(1)), case: level(at(2)),
                      charging: { left: charging(at(0)), right: charging(at(1)), case: charging(at(2)) } }
      out.kind = out.kind || "audio"
      return
    }
    i += 1 + len
  }
}

// "L 80 % · R 70 % · case 40 %⚡" — only the parts that are known.
function batteryText(battery) {
  if (!battery) return ""
  var parts = []
  var names = { left: "L", right: "R", case: "case" }
  for (var key in names) {
    var v = battery[key]
    if (v === undefined || v < 0) continue
    parts.push(names[key] + " " + v + " %" + (battery.charging && battery.charging[key] ? " ⚡" : ""))
  }
  return parts.join("  ·  ")
}

function sensorText(sensor) {
  if (!sensor) return ""
  var parts = []
  if (sensor.temperature !== undefined) parts.push(sensor.temperature.toFixed(1) + " °C")
  if (sensor.humidity !== undefined) parts.push(Math.round(sensor.humidity) + " %RH")
  if (sensor.pressure !== undefined) parts.push(Math.round(sensor.pressure) + " hPa")
  if (sensor.co2 !== undefined) parts.push(Math.round(sensor.co2) + " ppm CO₂")
  if (sensor.battery !== undefined) parts.push("battery " + Math.round(sensor.battery) + " %")
  return parts.join("  ·  ")
}
