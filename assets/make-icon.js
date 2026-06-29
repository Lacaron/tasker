// Generates assets/icon.png and assets/icon.ico — a rounded accent-blue tile
// with a white check mark. Pure Node (zlib), no native deps.
// Run: node assets/make-icon.js
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const ACCENT = [0x3b, 0x6f, 0xd6] // --tk-accent #3b6fd6
const WHITE = [0xff, 0xff, 0xff]

// Render the icon into an RGBA framebuffer at the given size. Geometry scales
// from the 256px reference design so every size stays crisp.
function render(SIZE) {
  const s = SIZE / 256
  const RADIUS = 56 * s
  const px = Buffer.alloc(SIZE * SIZE * 4, 0)

  function set(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const i = (y * SIZE + x) * 4
    const sa = a / 255
    const da = px[i + 3] / 255
    const oa = sa + da * (1 - sa)
    if (oa === 0) return
    const src = [r, g, b]
    for (let c = 0; c < 3; c++) {
      px[i + c] = Math.round((src[c] * sa + px[i + c] * da * (1 - sa)) / oa)
    }
    px[i + 3] = Math.round(oa * 255)
  }

  function insideRoundRect(fx, fy) {
    const minX = RADIUS, minY = RADIUS
    const maxX = SIZE - RADIUS, maxY = SIZE - RADIUS
    if (fx >= minX && fx <= maxX) return fy >= 0 && fy <= SIZE
    if (fy >= minY && fy <= maxY) return fx >= 0 && fx <= SIZE
    const cx = fx < minX ? minX : maxX
    const cy = fy < minY ? minY : maxY
    const dx = fx - cx, dy = fy - cy
    return dx * dx + dy * dy <= RADIUS * RADIUS
  }

  function tileAlpha(x, y) {
    let hit = 0
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        if (insideRoundRect(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hit++
      }
    }
    return Math.round((hit / 9) * 255)
  }

  // 1) tile
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = tileAlpha(x, y)
      if (a) set(x, y, ACCENT, a)
    }
  }

  // 2) check mark (two thick segments, scaled)
  function drawThickLine(x0, y0, x1, y1, width) {
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.hypot(dx, dy)
    const steps = Math.ceil(len * 3)
    const r = width / 2
    for (let st = 0; st <= steps; st++) {
      const t = st / steps
      const cx = x0 + dx * t, cy = y0 + dy * t
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy <= r * r) set(Math.round(cx + ox), Math.round(cy + oy), WHITE)
        }
      }
    }
  }
  drawThickLine(78 * s, 132 * s, 116 * s, 172 * s, Math.max(2, 16 * s))
  drawThickLine(116 * s, 172 * s, 184 * s, 86 * s, Math.max(2, 16 * s))

  return px
}

// ── PNG encoding ──────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crc])
}
function encodePNG(px, SIZE) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── ICO encoding (PNG-compressed entries, Vista+) ───────────────────────────
function encodeICO(entries /* [{size, png}] */) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)      // reserved
  header.writeUInt16LE(1, 2)      // type 1 = icon
  header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach((e, i) => {
    const b = i * 16
    dir[b] = e.size >= 256 ? 0 : e.size      // width  (0 means 256)
    dir[b + 1] = e.size >= 256 ? 0 : e.size  // height
    dir[b + 2] = 0  // palette
    dir[b + 3] = 0  // reserved
    dir.writeUInt16LE(1, b + 4)   // color planes
    dir.writeUInt16LE(32, b + 6)  // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += e.png.length
  })
  return Buffer.concat([header, dir, ...entries.map(e => e.png)])
}

// ── Emit ────────────────────────────────────────────────────────────────────
const png256 = encodePNG(render(256), 256)
fs.writeFileSync(path.join(__dirname, 'icon.png'), png256)

const ICO_SIZES = [16, 32, 48, 256]
const icoEntries = ICO_SIZES.map(size => ({
  size,
  png: size === 256 ? png256 : encodePNG(render(size), size),
}))
fs.writeFileSync(path.join(__dirname, 'icon.ico'), encodeICO(icoEntries))

console.log('Wrote icon.png and icon.ico (' + ICO_SIZES.join(', ') + ')')
