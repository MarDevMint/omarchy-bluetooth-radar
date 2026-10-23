// Run: node test/model.test.js
// Loads Model.js the way QML would (minus the .pragma line) and checks it.
const fs = require("fs")
const path = require("path")
const assert = require("assert")

// QML's .pragma/.import lines aren't JavaScript; strip them and hand the
// Vendors tables in as a variable instead.
const load = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8").replace(/^\.(pragma|import) .*$/gm, "")
const Vendors = new Function(load("Vendors.js") + "; return { COMPANIES, APPLE, SERVICES, APPEARANCE, BLUEZ_ICONS, NAME_HINTS, KINDS, CLASS_MAJOR, CLASS_AUDIO, CLASS_WEARABLE }")()
const Decode = new Function(load("Decode.js") + "; return { decode, bytes, batteryText, sensorText }")()
const Model = new Function("Vendors", "Decode", load("Model.js") + "; return { parseLine, label, sortBySignal, rssiText, smoothRssi, distanceMeters, radius, angle, distanceText, place, classify, details, glyph, referenceAt1m, calibrate, parseWifi, signalToDbm, shortVendor, classifyNetwork, placeNetworks, buildRows, nextRow, classInfo, calibrationProblem, clearCalibration, track, presence, isOutlier, median, mergeNetworks, filterDevices, nextRangeFilter, isNew, trendStep, slope, findLevel, findWord, clickInterval, fingerprint, reacquire, guardStep, suspectTracker, proximityStep, lockProblem, kindPhrase, calibrationValid }")(Vendors, Decode)
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, a + " ≉ " + b)

const tests = {
  "parses a snapshot and drops malformed devices"() {
    const s = Model.parseLine(JSON.stringify({ powered: true, scanning: true,
      devices: [{ id: "a", rssi: -60 }, { id: "", rssi: -50 }, { id: "b", rssi: "x" }, null] }))
    assert.deepStrictEqual(s.devices.map(d => d.id), ["a"])
    assert.strictEqual(s.scanning, true)
  },
  "passes errors through"() {
    assert.deepStrictEqual(Model.parseLine('{"error":"no Bluetooth adapter"}'), { error: "no Bluetooth adapter" })
  },
  "ignores junk lines"() {
    assert.strictEqual(Model.parseLine("not json"), null)
    assert.strictEqual(Model.parseLine('{"powered":true}'), null)
    assert.strictEqual(Model.parseLine(""), null)
  },
  "labels devices honestly"() {
    assert.strictEqual(Model.label({ name: " L6370 Series " }), "L6370 Series")
    assert.strictEqual(Model.label({ makers: { "76": 18 }, addrType: "random" }), "Apple · Find My")
    assert.strictEqual(Model.label({ makers: { "117": 66 } }), "Samsung device")
    assert.strictEqual(Model.label({ name: "", addrType: "random" }), "Anonymous device")
    assert.strictEqual(Model.label({ addrType: "public" }), "Unknown device")
    assert.strictEqual(Model.label({ uuids: ["fe95"] }), "Xiaomi device")
  },
  "sorts strongest first, stable on ties"() {
    const sorted = Model.sortBySignal([{ id: "b", rssi: -70 }, { id: "c", rssi: -50 }, { id: "a", rssi: -70 }])
    assert.deepStrictEqual(sorted.map(d => d.id), ["c", "a", "b"])
  },
  "formats rssi"() {
    assert.strictEqual(Model.rssiText({ rssi: -71.6 }), "-72 dBm")
  },
  "smooths rssi, first reading passes through"() {
    assert.strictEqual(Model.smoothRssi(undefined, -70), -70)
    near(Model.smoothRssi(-70, -60), -67)
  },
  "estimates distance from rssi"() {
    near(Model.distanceMeters(-59, -59), 1)
    near(Model.distanceMeters(-84, -59), 10)
    assert.ok(Model.distanceMeters(-90, -59) > Model.distanceMeters(-60, -59))
  },
  "picks the 1 m reference: calibration, then tx power, then kind"() {
    assert.strictEqual(Model.referenceAt1m({ kind: "watch" }), -68)
    assert.strictEqual(Model.referenceAt1m({ kind: "watch", txPower: -20 }), -61)
    assert.strictEqual(Model.referenceAt1m({ kind: "watch", txPower: 0 }), -68)    // -41 at 1 m: not believable
    assert.strictEqual(Model.referenceAt1m({ kind: "phone", txPower: 12 }), -62)   // Apple's 12 dBm
    assert.strictEqual(Model.referenceAt1m({ kind: "watch", txPower: 0 }, { watch: -70 }), -70)
    assert.strictEqual(Model.referenceAt1m({ kind: "nonsense" }), -60)
    assert.strictEqual(Model.referenceAt1m({ kind: "watch" }, { watch: "junk" }), -68)
  },
  "a watch at -69 dBm reads about a metre, not three"() {
    const [d] = Model.place([{ id: "cc0000", rssi: -69, name: "Galaxy Fit3", uuids: ["180d"] }], [], 10, 0)
    assert.strictEqual(d.kind, "watch")
    assert.ok(d.meters < 1.5, d.meters)
  },
  "calibration makes the current signal read one metre"() {
    const [d] = Model.place([{ id: "dd0000", rssi: -75, makers: { "76": 16 } }], [], 10, 0)
    const cal = Model.calibrate({}, d)
    assert.deepStrictEqual(cal, { phone: -75 })
    const [again] = Model.place([{ id: "dd0000", rssi: -75, makers: { "76": 16 } }], [], 10, 0, cal)
    near(again.meters, 1)
  },
  "maps distance onto a log radius"() {
    assert.strictEqual(Model.radius(0.1, 10), 0)
    assert.strictEqual(Model.radius(50, 10), 1)
    assert.ok(Model.radius(1, 10) < Model.radius(3, 10))
  },
  "gives each id a stable angle"() {
    assert.strictEqual(Model.angle("ffffff00"), 0xffffff % 360)
    assert.strictEqual(Model.angle("abc123ff"), Model.angle("abc123ff"))
  },
  "formats distance"() {
    assert.strictEqual(Model.distanceText(0.6), "< 1 m")
    assert.strictEqual(Model.distanceText(3.4), "~3 m")
    assert.strictEqual(Model.distanceText(23), "~25 m")
  },
  "places devices carrying smoothing and first-seen forward"() {
    const first = Model.place([{ id: "aa0000", rssi: -70 }], [], 10, 1000)
    const second = Model.place([{ id: "aa0000", rssi: -60 }], first, 10, 5000)
    assert.ok(second[0].smoothed > -67 && second[0].smoothed < -62, "Kalman moves most of the way")
    assert.ok(second[0].variance < 16)
    assert.ok(second[0].radius > 0 && second[0].radius < 1)
    assert.strictEqual(second[0].rssi, -60)
    assert.strictEqual(second[0].firstSeen, 1000)
  },
  "trusts a busy second more than a lone reading"() {
    const prev = { smoothed: -70, variance: 4, history: [-70, -70, -71, -69] }
    const one = Model.track(prev, { rssi: -76, n: 1 }, 1)
    const many = Model.track(prev, { rssi: -76, n: 8 }, 1)
    assert.ok(many.smoothed < one.smoothed, many.smoothed + " vs " + one.smoothed)
  },
  "ignores a sudden drop as an outlier but keeps it in history"() {
    const prev = { smoothed: -60, variance: 2, history: [-60, -61, -59, -60, -60] }
    const t = Model.track(prev, { rssi: -85, n: 3 }, 1)
    near(t.smoothed, -60)
    assert.strictEqual(t.history[t.history.length - 1], -85)
    assert.strictEqual(Model.isOutlier(-61, [-60, -61, -59, -60]), 0)
    // The same drop again is believed: someone walked away.
    const again = Model.track(t, { rssi: -85, n: 3 }, 1)
    assert.ok(again.smoothed < -65, String(again.smoothed))
  },
  "a silent second holds the estimate and grows doubt"() {
    const t = Model.track({ smoothed: -66, variance: 3, history: [-66] }, { rssi: -66, n: 0 }, 2)
    near(t.smoothed, -66)
    assert.ok(t.variance > 3)
    assert.deepStrictEqual(t.history, [-66])
  },
  "fades a device as it goes quiet"() {
    assert.strictEqual(Model.presence(0.4), 1)
    assert.strictEqual(Model.presence(undefined), 1)
    assert.strictEqual(Model.presence(7), 1)
    assert.ok(Model.presence(10) < 1 && Model.presence(10) > 0.25)
    assert.strictEqual(Model.presence(12), 0.25)
    assert.strictEqual(Model.median([3, 1, 2, 10]), 2.5)
  },
  "classifies from the strongest clue"() {
    const c = d => Model.classify(d)
    assert.strictEqual(c({ makers: { "76": 7 } }).kind, "audio")             // AirPods
    assert.strictEqual(c({ makers: { "76": 18 } }).kind, "tracker")          // Find My, no payload
    assert.strictEqual(c({ makers: { "76": 18 }, mfr: { "76": "12020000" } }).kind, "phone")
    assert.strictEqual(c({ makers: { "6": 1 } }).detail, "Windows PC")
    assert.strictEqual(c({ makers: { "64": 0 }, name: "L6370 Series" }).kind, "printer")
    assert.strictEqual(c({ uuids: ["fef3"] }).kind, "phone")
    assert.strictEqual(c({ uuids: ["fef3"] }).vendor, "Google")
    assert.strictEqual(c({ appearance: 0x00c1 }).kind, "watch")              // category 3
    assert.strictEqual(c({ name: "Galaxy Buds2" }).kind, "audio")            // name beats nothing
    assert.strictEqual(c({ icon: "phone", name: "Galaxy Buds2" }).kind, "phone") // BlueZ before name
    assert.strictEqual(c({}).kind, "unknown")
  },
  "lists details including unknown company ids"() {
    const [d] = Model.place([{ id: "bb0000", rssi: -80, makers: { "1602": 2 }, addrType: "public" }], [], 10, 0)
    const rows = Object.fromEntries(Model.details(d, 65000))
    assert.strictEqual(rows["Company id"], "1602")
    assert.strictEqual(rows["Address"], "Fixed (public)")
    assert.strictEqual(rows["Seen for"], "1 min")
  },
  "parses wifi lines and ignores junk"() {
    const w = Model.parseWifi(JSON.stringify({ networks: [{ id: "a", signal: 50 }, { id: "", signal: 1 }, { id: "b" }] }))
    assert.deepStrictEqual(w.networks.map(n => n.id), ["a"])
    assert.deepStrictEqual(Model.parseWifi('{"error":"nmcli failed"}'), { error: "nmcli failed" })
    assert.strictEqual(Model.parseWifi("nope"), null)
  },
  "maps NetworkManager strength to dBm"() {
    assert.strictEqual(Model.signalToDbm(100), -40)
    assert.strictEqual(Model.signalToDbm(0), -100)
    assert.strictEqual(Model.signalToDbm(77), -54)
  },
  "shortens registry vendor names"() {
    assert.strictEqual(Model.shortVendor("HUAWEI TECHNOLOGIES CO.,LTD"), "Huawei")
    assert.strictEqual(Model.shortVendor("zte corporation"), "ZTE")
    assert.strictEqual(Model.shortVendor("TP-Link Systems Inc"), "TP-Link")
    assert.strictEqual(Model.shortVendor(""), "")
  },
  "classifies networks"() {
    assert.strictEqual(Model.classifyNetwork({ ssid: "DIRECT-hv-EPSON-L5190 Series" }).kind, "printer")
    assert.strictEqual(Model.classifyNetwork({ ssid: "PROJ25e80b" }).kind, "tv")
    assert.strictEqual(Model.classifyNetwork({ ssid: "HomeNet 5G" }).kind, "router")
  },
  "places networks with their own reference"() {
    const [n] = Model.placeNetworks([{ id: "ee0000", ssid: "", signal: 100, vendor: "zte corporation" }], [], 10, 0)
    assert.strictEqual(n.source, "wifi")
    assert.strictEqual(n.name, "Hidden network")
    assert.strictEqual(n.vendor, "ZTE")
    assert.ok(n.meters > 1 && n.meters < 5, n.meters)   // a strong AP is in the room or next to it
    const rows = Object.fromEntries(Model.details(n, 2000))
    assert.strictEqual(rows["Signal"], "100 %  ·  -40 dBm")
  },
  "builds sectioned rows and walks them skipping headers"() {
    const rows = Model.buildRows([{ id: "a" }, { id: "b" }], [{ id: "w" }])
    assert.deepStrictEqual(rows.map(r => r.header || r.id), ["NEARBY · 2", "a", "b", "WI-FI · 1", "w"])
    assert.strictEqual(Model.nextRow(rows, -1, 1), 1)        // first item, not the header
    assert.strictEqual(Model.nextRow(rows, -1, -1), 4)       // last item
    assert.strictEqual(Model.nextRow(rows, 2, 1), 4)         // jumps the Wi-Fi header
    assert.strictEqual(Model.nextRow(rows, 1, -1), 1)        // stays at the top
    assert.deepStrictEqual(Model.buildRows([], []), [])
  },
  "reads classic Bluetooth class of device"() {
    assert.deepStrictEqual(Model.classInfo(0x340408), ["audio", "Hands-free"])        // car stereo kit seen live
    assert.deepStrictEqual(Model.classInfo(0x08243c), ["tv", "Display and speaker"])  // second device seen live
    assert.deepStrictEqual(Model.classInfo(0x5a020c), ["phone", ""])                  // smartphone
    assert.deepStrictEqual(Model.classInfo(0x000704), ["watch", "Wristwatch"])
    assert.deepStrictEqual(Model.classInfo(0x002540), ["input", "Keyboard"])
    assert.deepStrictEqual(Model.classInfo(0x002508), ["gamepad", "Gamepad"])
    assert.strictEqual(Model.classInfo(0), null)
  },
  "classifies a classic device from its class and says so in details"() {
    const [d] = Model.place([{ id: "ff0000", rssi: -80, classic: true, class: 0x340408, name: "DEH-X4650BT", addrType: "public" }], [], 10, 0)
    assert.strictEqual(d.kind, "audio")
    assert.strictEqual(d.detail, "Hands-free")
    assert.strictEqual(Object.fromEntries(Model.details(d, 0))["Radio"], "Classic (discoverable)")
  },
  "refuses impossible calibrations and clears one kind"() {
    assert.strictEqual(Model.calibrationProblem({ smoothed: -60 }), "")
    assert.ok(Model.calibrationProblem({ smoothed: -97 }).includes("Too weak"))
    assert.ok(Model.calibrationProblem({ smoothed: -42 }).includes("Too strong"))
    // Old impossible calibrations are ignored, the built-in guess stands.
    assert.strictEqual(Model.referenceAt1m({ kind: "phone" }, { phone: -97 }), -62)
    assert.strictEqual(Model.referenceAt1m({ kind: "watch" }, { watch: -46 }), -68)
    assert.strictEqual(Model.referenceAt1m({ kind: "phone" }, { phone: -70 }), -70)
    assert.deepStrictEqual(Model.clearCalibration({ phone: -70, watch: -60 }, "phone"), { watch: -60 })
    assert.deepStrictEqual(Model.clearCalibration(undefined, "phone"), {})
  },
  "decodes AirPods model and batteries"() {
    const d = Decode.decode({ mfr: { "76": "0719010e2055894502" + "00".repeat(18) } })
    assert.strictEqual(d.model, "AirPods Pro")
    assert.deepStrictEqual([d.battery.left, d.battery.right, d.battery.case, d.battery.charging.case], [80, 90, 50, true])
    assert.strictEqual(Decode.batteryText(d.battery), "L 80 %  ·  R 90 %  ·  case 50 % ⚡")
    const [placed] = Model.place([{ id: "ab0000", rssi: -60, mfr: { "76": "0719010e2055894502" + "00".repeat(18) }, makers: { "76": 7 } }], [], 10, 0)
    assert.strictEqual(Model.label(placed), "AirPods Pro")
    assert.strictEqual(Object.fromEntries(Model.details(placed, 0))["Model"], "AirPods Pro")
  },
  "reads several Apple messages in one advert"() {
    const d = Decode.decode({ mfr: { "76": "10050a98aabbcc" + "0c0e00" + "00".repeat(14) } })
    assert.strictEqual(d.model, "Apple Watch")
    assert.strictEqual(d.activity, "Watch on wrist")
  },
  "tells a Windows laptop from a desktop"() {
    assert.strictEqual(Decode.decode({ mfr: { "6": "010f20" } }).model, "Windows laptop")
    assert.strictEqual(Decode.decode({ mfr: { "6": "0109" } }).model, "Windows desktop")
    const [d] = Model.place([{ id: "ac0000", rssi: -60, mfr: { "6": "010f20" }, makers: { "6": 1 } }], [], 10, 0)
    assert.strictEqual(d.kind, "computer")
  },
  "decodes sensors that broadcast readings"() {
    const ruuvi = Decode.decode({ mfr: { "1177": "0512FC5394C37C0004FFFC040CAC364200CDCBB8334C884F".toLowerCase() } })
    near(ruuvi.sensor.temperature, 24.3)
    near(ruuvi.sensor.pressure, 1000.44)
    near(ruuvi.sensor.humidity, 53.49)
    const mi = Decode.decode({ svc: { "fe95": "5020aa01fe1122334455660d1004b2007502" } })
    assert.strictEqual(mi.model, "Mi thermometer")
    near(mi.sensor.temperature, 17.8); near(mi.sensor.humidity, 62.9)
    const bt = Decode.decode({ svc: { "fcd2": "4002c40903bf13" } })
    near(bt.sensor.temperature, 25); near(bt.sensor.humidity, 50.55)
    assert.strictEqual(Decode.decode({ svc: { "fcd2": "4102c409" } }).sensor, undefined)  // encrypted
    assert.strictEqual(Decode.sensorText(bt.sensor), "25.0 °C  ·  51 %RH")
  },
  "recognises trackers and whether they are away from their owner"() {
    const tag = Decode.decode({ mfr: { "76": "1219105566" + "00".repeat(22) } })
    assert.deepStrictEqual([tag.model, tag.tracker.separated], ["AirTag", true])
    assert.strictEqual(Decode.decode({ mfr: { "76": "12021000aa" } }).tracker.separated, false)
    // An iPhone near its owner sends Find My too: not a tracker.
    const phone = Decode.decode({ mfr: { "76": "12020000" } })
    assert.deepStrictEqual([phone.kind, phone.tracker.separated], ["phone", false])
    assert.strictEqual(Decode.decode({ svc: { "fd5a": "12000000" } }).tracker.separated, true)
    assert.strictEqual(Decode.decode({ svc: { "fd5a": "11000000" } }).tracker.separated, false)
    assert.strictEqual(Decode.decode({ svc: { "fcb2": "0100" } }).tracker.separated, true)
    assert.strictEqual(Decode.decode({ svc: { "feaa": "41" + "00".repeat(20) } }).tracker.separated, true)
    assert.strictEqual(Decode.decode({ svc: { "feaa": "10" } }).tracker, undefined)  // plain Eddystone URL
    assert.strictEqual(Decode.decode({ uuids: ["feed"] }).tracker.network, "Tile")
  },
  "scores camera glasses, never claiming more than the evidence"() {
    const high = Decode.decode({ mfr: { "427": "020102102716e4" }, uuids: ["fd5f"] })
    assert.deepStrictEqual([high.glasses.level, high.kind], ["high", "glasses"])
    assert.strictEqual(Decode.decode({ name: "Ray-Ban Meta" }).glasses.level, "medium")
    const low = Decode.decode({ mfr: { "427": "00" } })
    assert.strictEqual(low.glasses, undefined)  // a Quest or a phone app could send this
    assert.strictEqual(Decode.decode({ uuids: ["fd5f"] }).glasses.level, "low")
    assert.notStrictEqual(Decode.decode({ uuids: ["fd5f"] }).kind, "glasses")
  },
  "reads Fast Pair battery and pairing mode"() {
    assert.strictEqual(Decode.decode({ svc: { "fe2c": "0010ff13d0" } }).battery.right, -1)   // one value only
    assert.strictEqual(Decode.decode({ svc: { "fe2c": "0010ff33d0" } }).battery, undefined) // says 3, has 1
    assert.strictEqual(Decode.decode({ svc: { "fe95": "5020aa01fe1122334455660d1001b2" } }).sensor, undefined)
    const d = Decode.decode({ svc: { "fe2c": "0010ff21abcd33d0467f" } })
    assert.deepStrictEqual([d.battery.left, d.battery.charging.left, d.battery.right, d.battery.case], [80, true, 70, -1])
    assert.strictEqual(Decode.decode({ svc: { "fe2c": "2a410b" } }).activity, "Ready to pair (Fast Pair)")
  },
  "ignores truncated and junk payloads"() {
    assert.deepStrictEqual(Decode.decode({ mfr: { "76": "0719" } }), {})
    assert.deepStrictEqual(Decode.decode({ mfr: { "76": "zz" }, svc: { "fe95": "01" } }), {})
    assert.deepStrictEqual(Decode.decode({}), {})
  },
  "folds repeaters and hidden companions into one router"() {
    const nets = [
      { id: "b", ssid: "HomeNet 5G", band: "5 GHz", channel: 56, signal: 67 },
      { id: "a", ssid: "HomeNet 5G", band: "5 GHz", channel: 56, signal: 29 },
      { id: "h1", ssid: "", band: "5 GHz", channel: 56, signal: 64 },
      { id: "h2", ssid: "", band: "5 GHz", channel: 157, signal: 30 },
      { id: "c", ssid: "HomeNet 2.4", band: "2.4 GHz", channel: 3, signal: 70 }
    ]
    const m = Model.mergeNetworks(nets)
    assert.strictEqual(m.length, 3)
    const five = m.find(n => n.ssid === "HomeNet 5G")
    assert.deepStrictEqual([five.id, five.signal, five.aps, five.hiddenSiblings], ["a", 67, 2, 1])
    const [hidden] = Model.placeNetworks([nets[3]], [], 10, 0)
    assert.strictEqual(hidden.name, "Hidden network · 5 GHz ch 157")
  },
  "labels and merges Wi-Fi the way people read it"() {
    const nets = [
      { id: "a", ssid: "HomeNet 5G", band: "5 GHz", channel: 56, signal: 60 },
      { id: "b", ssid: "HomeNet 5G", band: "5 GHz", channel: 56, signal: 25 },
      { id: "h", ssid: "", band: "5 GHz", channel: 56, signal: 26 },
      { id: "c", ssid: "Cafe&Bar", band: "2.4 GHz", channel: 1, signal: 40 },
      { id: "d", ssid: "Cafe&Bar", band: "5 GHz", channel: 157, signal: 30 }
    ]
    const placed = Model.placeNetworks(nets, [], 10, 0)
    assert.strictEqual(placed.length, 3)                        // hidden matched the weaker AP
    assert.deepStrictEqual(placed.map(n => n.name).sort(), ["Cafe&Bar · 2.4 GHz", "Cafe&Bar · 5 GHz", "HomeNet 5G"])
    assert.strictEqual(Model.shortVendor("TP-LINK TECHNOLOGIES CO.,LTD."), "TP-Link")
    assert.strictEqual(Model.shortVendor("TP-Link Systems Inc"), "TP-Link")
  },
  "filters by range and identity but keeps the selection"() {
    const ds = [{ id: "a", meters: 2, kind: "phone" }, { id: "b", meters: 15, kind: "tv" }, { id: "c", meters: 1, kind: "unknown", name: "" }]
    assert.deepStrictEqual(Model.filterDevices(ds, 10, false).map(d => d.id), ["a", "c"])
    assert.deepStrictEqual(Model.filterDevices(ds, 0, true).map(d => d.id), ["a", "b"])
    assert.deepStrictEqual(Model.filterDevices(ds, 3, true, "b").map(d => d.id), ["a", "b"])
    assert.deepStrictEqual([0, 10, 3].map(Model.nextRangeFilter), [10, 3, 0])
  },
  "marks arrivals as new, not the first sweep"() {
    const start = 1000000
    assert.ok(Model.isNew({ source: "bt", firstSeen: start + 60000 }, start + 65000, start))
    assert.ok(!Model.isNew({ source: "bt", firstSeen: start + 2000 }, start + 5000, start))
    assert.ok(!Model.isNew({ source: "bt", firstSeen: start + 60000 }, start + 90000, start))
  },
  "reads Samsung frame families and Xiaomi identities (captured layouts, made-up addresses)"() {
    const tv = Decode.decode({ mfr: { "117": "42040180660012fb1234560212fb12345501650000000000" } })
    assert.deepStrictEqual([tv.kind, tv.stableKey], ["tv", "samsung:00:12:FB:12:34:56"])
    const watch = Decode.decode({ mfr: { "117": "010002000101ff0000431c" } })
    assert.deepStrictEqual([watch.kind, watch.model], ["watch", "Galaxy Watch6"])
    assert.strictEqual(Decode.decode({ mfr: { "117": "0100020001030" + "2" } }).model, "Galaxy Watch")
    assert.strictEqual(Decode.decode({ mfr: { "117": "80c4c21e298c" } }).kind, undefined)
    const redmi = Decode.decode({ svc: { "fe95": "125b3b4800665544332211" } })
    assert.deepStrictEqual([redmi.kind, redmi.model, redmi.stableKey], ["watch", "Redmi Watch 5 Active", "xiaomi:11:22:33:44:55:66"])
    assert.strictEqual(Decode.decode({ svc: { "fd69": "00".repeat(20) } }).tracker.network, "Samsung Find")
  },
  "sees someone walking closer, ignores noise, and lets go with hysteresis"() {
    let st = {}
    // Approaching: -80 → -64 over 8 s with ±2 dB jitter.
    const walk = [-80, -76, -79, -73, -72, -70, -68, -67, -64]
    walk.forEach((r, i) => { st = Object.assign(st, Model.trendStep(st, { rssi: r, n: 2 }, i * 1000)) })
    assert.strictEqual(st.trend, 1, "slope " + st.slope)
    // Standing still at -64 with noise: the trend ends.
    for (let i = 9; i < 25; i++) st = Object.assign(st, Model.trendStep(st, { rssi: -64 + (i % 2 ? 2 : -2), n: 2 }, i * 1000))
    assert.strictEqual(st.trend, 0)
    // Pure noise never calls a trend.
    let q = {}
    for (let i = 0; i < 20; i++) q = Object.assign(q, Model.trendStep(q, { rssi: -70 + [3, -3, 1, -2, 4, -4][i % 6], n: 1 }, i * 1000))
    assert.strictEqual(q.trend, 0, "noise slope " + q.slope)
    // Silent seconds add no points; too few points → no call.
    assert.strictEqual(Model.trendStep({}, { rssi: -60, n: 0 }, 0).trail.length, 0)
    near(Model.slope([[0, -70], [1000, -69], [2000, -68]]), 1)
  },
  "find mode: hot and cold from signal, follows an address change"() {
    assert.strictEqual(Model.findLevel({ smoothed: -95 }), 0)
    assert.strictEqual(Model.findLevel({ smoothed: -40 }), 1)
    near(Model.findLevel({ smoothed: -70 }), 0.5)
    assert.strictEqual(Model.findLevel(null), 0)
    assert.ok(Model.findWord(0.9, false).startsWith("Very hot"))
    assert.ok(Model.findWord(0.9, true).startsWith("Signal lost"))
    assert.ok(Model.clickInterval(0) > 1500 && Model.clickInterval(1) === 200)
    const lost = { id: "old", kind: "watch", vendor: "Samsung", model: "Galaxy Watch6", smoothed: -70 }
    const now = [{ id: "x", kind: "phone", vendor: "Samsung", smoothed: -50 },
                 { id: "new1", kind: "watch", vendor: "Samsung", model: "Galaxy Watch6", smoothed: -80 },
                 { id: "new2", kind: "watch", vendor: "Samsung", model: "Galaxy Watch6", smoothed: -66 }]
    assert.strictEqual(Model.reacquire(lost, now).id, "new2")
    assert.strictEqual(Model.reacquire({ id: "u", kind: "unknown" }, now), null)
    assert.strictEqual(Model.reacquire({ id: "u", kind: "phone", vendor: "", model: "" }, [{ id: "v", kind: "phone", smoothed: -60 }]), null)
    assert.strictEqual(Model.fingerprint({ stableKey: "samsung:E0" }), "samsung:E0")
  },
  "guard: alerts on a separated tracker only after 3 sightings over 30 min"() {
    const tag = { id: "t1", kind: "tracker", tracker: { network: "Apple Find My", separated: true, what: "AirTag" }, model: "AirTag", meters: 2, smoothed: -60 }
    let log = {}, alerts = []
    for (const min of [0, 10, 20]) ({ log, alerts } = Model.guardStep(log, [tag], min * 60000))
    assert.strictEqual(alerts.length, 0)   // 3 sightings but only 20 min
    ;({ log, alerts } = Model.guardStep(log, [tag], 31 * 60000))
    assert.strictEqual(alerts.length, 1)
    assert.strictEqual(alerts[0].kind, "tracker")
    ;({ log, alerts } = Model.guardStep(log, [tag], 40 * 60000))
    assert.strictEqual(alerts.length, 0)   // no repeat within 4 h
    // Near its owner, or a Galaxy phone in offline mode: never.
    assert.ok(!Model.suspectTracker({ kind: "tracker", tracker: { network: "Apple Find My", separated: false } }))
    assert.ok(!Model.suspectTracker({ kind: "unknown", tracker: { network: "Samsung Find", separated: true, what: "Galaxy device offline" } }))
    // A lost SmartTag is exactly what Guard is for.
    assert.ok(Model.suspectTracker({ kind: "tracker", tracker: { network: "Samsung Find", separated: true, what: "Lost" } }))
    // Repeated snapshots within a minute are one sighting.
    let l2 = {}
    for (let sec = 0; sec < 50; sec += 5) l2 = Model.guardStep(l2, [tag], sec * 1000).log
    assert.strictEqual(Object.values(l2)[0].count, 1)
  },
  "guard: glasses alert when near, then waits 10 min"() {
    const g = { id: "g1", kind: "glasses", glasses: { level: "high", maker: "Meta" }, meters: 2, smoothed: -60 }
    let r = Model.guardStep({}, [g], 0)
    assert.strictEqual(r.alerts[0].kind, "glasses")
    assert.strictEqual(Model.guardStep(r.log, [g], 5 * 60000).alerts.length, 0)
    assert.strictEqual(Model.guardStep(r.log, [g], 11 * 60000).alerts.length, 1)
    assert.strictEqual(Model.guardStep({}, [Object.assign({}, g, { smoothed: -85 })], 0).alerts.length, 0)  // far
  },
  "follows a device across an address change, keeping its id and history"() {
    const watch = (id, rssi, age) => ({ id, rssi, n: 1, age, name: "", mfr: { "117": "010002000101ff0000431c" }, makers: { "117": 1 } })
    let placed = Model.place([watch("old", -70, 0.5)], [], 10, 1000)
    placed = Model.place([watch("old", -70, 0.5)], placed, 10, 2000)
    // The watch rotates: the old address goes quiet, a new one appears.
    placed = Model.place([watch("old", -70, 4), watch("new", -72, 0.3)], placed, 10, 6000)
    assert.strictEqual(placed.length, 1)
    assert.deepStrictEqual([placed[0].id, placed[0].hid, placed[0].firstSeen], ["old", "new", 1000])
    // The old address still trickles in from the helper for a while: ignored.
    placed = Model.place([watch("old", -70, 8), watch("new", -71, 0.2)], placed, 10, 7000)
    assert.deepStrictEqual(placed.map(d => d.id), ["old"])
    assert.ok(Object.fromEntries(Model.details(placed[0], 7000))["Address changes"].startsWith("Changed 1 time"))
  },
  "links a rotation even when the old address takes a few seconds to fall quiet"() {
    const watch = (id, rssi, age) => ({ id, rssi, n: 1, age, mfr: { "117": "010002000101ff0000431c" } })
    let placed = Model.place([watch("old", -70, 0.5)], [], 10, 1000)
    placed = Model.place([watch("old", -70, 1), watch("new", -71, 0.2)], placed, 10, 2000)   // both live
    assert.strictEqual(placed.length, 2)
    placed = Model.place([watch("old", -70, 4), watch("new", -71, 0.2)], placed, 10, 5000)   // old now quiet
    assert.deepStrictEqual(placed.map(d => [d.id, d.hid]), [["old", "new"]])
  },
  "does not merge two look-alikes when it can't tell which is which"() {
    const phone = (id, rssi, age) => ({ id, rssi, n: 1, age, mfr: { "6": "0109" }, makers: { "6": 1 } })
    let placed = Model.place([phone("a", -60, 0.5), phone("b", -80, 0.5)], [], 10, 1000)
    placed = Model.place([phone("a", -60, 4), phone("b", -80, 4), phone("c", -61, 0.2), phone("d", -79, 0.2)], placed, 10, 5000)
    assert.strictEqual(placed.length, 4)
    // A big signal jump is not the same device either.
    let p2 = Model.place([phone("a", -60, 0.5)], [], 10, 1000)
    p2 = Model.place([phone("a", -60, 4), phone("z", -90, 0.2)], p2, 10, 5000)
    assert.strictEqual(p2.length, 2)
  },
  "merges entries that carry the same address inside their payload"() {
    const tv = (id, age) => ({ id, rssi: -80, n: 1, age, mfr: { "117": "42040180660012fb1234560212fb12345501650000000000" } })
    const placed = Model.place([tv("x", 2), tv("y", 0.5)], [], 10, 1000)
    assert.strictEqual(placed.length, 1)
    assert.strictEqual(placed[0].hid, "y")
  },
  "proximity lock: warns, then locks only when away and idle; never while in use"() {
    const near = { smoothed: -60 }, weak = { smoothed: -80 }
    let st = Model.proximityStep(null, near, 0, true, true, -60)
    assert.strictEqual(st.phase, "near")
    st = Model.proximityStep(st, null, 1000, true, true, -60)            // gone
    assert.strictEqual(st.phase, "away")
    st = Model.proximityStep(st, weak, 15000, true, true, -60)           // still weak (-20 dB)
    assert.strictEqual(st.phase, "away")
    st = Model.proximityStep(st, weak, 22000, false, true, -60)          // 21 s but you're typing
    assert.strictEqual(st.phase, "away")
    st = Model.proximityStep(st, weak, 23000, true, true, -60)
    assert.deepStrictEqual([st.phase, st.action], ["warning", "warn"])
    const cancelled = Model.proximityStep(st, weak, 25000, false, true, -60)  // mouse moved
    assert.deepStrictEqual([cancelled.phase, cancelled.action], ["away", "cancel"])
    st = Model.proximityStep(st, weak, 28500, true, true, -60)
    assert.deepStrictEqual([st.phase, st.action], ["locked", "lock"])
    st = Model.proximityStep(st, null, 40000, true, true, -60)           // stays locked, no repeat
    assert.deepStrictEqual([st.phase, st.action], ["locked", ""])
    st = Model.proximityStep(st, near, 50000, true, true, -60)           // back: re-armed
    assert.strictEqual(st.phase, "near")
    // Small dips are not leaving.
    assert.strictEqual(Model.proximityStep({ phase: "near", since: 0 }, { smoothed: -70 }, 1000, true, true, -60).phase, "near")
    // Scan not running: pause, never lock.
    assert.strictEqual(Model.proximityStep({ phase: "away", since: 0 }, null, 60000, true, false, -60).phase, "near")
    assert.ok(Model.lockProblem({ source: "bt", smoothed: -60 }).includes("pair"))
    assert.strictEqual(Model.lockProblem({ source: "bt", smoothed: -60, pkey: "ab" }), "")
  },
  "says kinds in the plural properly"() {
    assert.deepStrictEqual(["watch", "phone", "audio", "tv", "input", "glasses", "fitness"].map(Model.kindPhrase),
      ["watches", "phones", "audio devices", "tv / display devices", "keyboard / mouse devices", "smart glasses", "fitness devices"])
    assert.ok(!Model.calibrationValid(-97) && Model.calibrationValid(-62) && !Model.calibrationValid("x"))
  },
  "has a glyph for every kind"() {
    for (const kind of Object.keys(Vendors.KINDS)) assert.ok(Model.glyph(kind).length > 0)
    assert.strictEqual(Model.glyph("nonsense"), Model.glyph("unknown"))
  }
}

let failed = 0
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log("ok   " + name) } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message) }
}
process.exit(failed ? 1 : 0)
