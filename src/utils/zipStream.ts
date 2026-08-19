import type { Writable } from "stream";

// Streaming ZIP writer — always uses ZIP64 extensions so archives beyond 4 GB
// (e.g. 9 999 × 2 000×2 000 PNG) write correctly. ZIP64 is supported by every
// modern zip tool (7-Zip, macOS Archive Utility, Windows Explorer 10+).
//
// Compression method STORED (0) — images are already PNG/WEBP-compressed so
// DEFLATE would cost CPU for negligible size savings.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Write a BigInt as a little-endian 64-bit value into buf at offset.
function writeUInt64LE(buf: Buffer, value: bigint, offset: number) {
  const lo = Number(value & 0xFFFFFFFFn);
  const hi = Number((value >> 32n) & 0xFFFFFFFFn);
  buf.writeUInt32LE(lo, offset);
  buf.writeUInt32LE(hi, offset + 4);
}

interface ZipEntryRecord {
  name: string;
  crc: number;
  size: bigint;
  offset: bigint;
}

export class ZipStream {
  private out: Writable;
  private offset: bigint = 0n;
  private entries: ZipEntryRecord[] = [];

  constructor(out: Writable) {
    this.out = out;
  }

  private writeBuf(buf: Buffer) {
    this.out.write(buf);
    this.offset += BigInt(buf.length);
  }

  addFile(name: string, data: Buffer) {
    const crc    = crc32(data);
    const size   = BigInt(data.length);
    const nameBuf = Buffer.from(name, "utf8");
    const localHeaderOffset = this.offset;

    // ZIP64 extra field for local header (20 bytes)
    const zip64Extra = Buffer.alloc(20);
    zip64Extra.writeUInt16LE(0x0001, 0); // ZIP64 tag
    zip64Extra.writeUInt16LE(16,     2); // data size (two 8-byte fields)
    writeUInt64LE(zip64Extra, size, 4);  // uncompressed size
    writeUInt64LE(zip64Extra, size, 12); // compressed size

    // Local file header (30 bytes) — sizes set to 0xFFFFFFFF to signal ZIP64
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,  0); // local file header signature
    header.writeUInt16LE(45,          4); // version needed: 4.5 (ZIP64)
    header.writeUInt16LE(0x0800,      6); // flags: UTF-8 filename
    header.writeUInt16LE(0,           8); // compression: STORED
    header.writeUInt16LE(0,          10); // mod time
    header.writeUInt16LE(0x21,       12); // mod date
    header.writeUInt32LE(crc,        14); // CRC-32
    header.writeUInt32LE(0xFFFFFFFF, 18); // compressed size  → ZIP64 extra
    header.writeUInt32LE(0xFFFFFFFF, 22); // uncompressed size → ZIP64 extra
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(zip64Extra.length, 28);

    this.writeBuf(header);
    this.writeBuf(nameBuf);
    this.writeBuf(zip64Extra);
    this.writeBuf(data);

    this.entries.push({ name, crc, size, offset: localHeaderOffset });
  }

  finish() {
    const centralDirStart: bigint = this.offset;

    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, "utf8");

      // ZIP64 extra field for central directory (28 bytes)
      const zip64Extra = Buffer.alloc(28);
      zip64Extra.writeUInt16LE(0x0001, 0); // ZIP64 tag
      zip64Extra.writeUInt16LE(24,     2); // data size (three 8-byte fields)
      writeUInt64LE(zip64Extra, entry.size,   4); // uncompressed size
      writeUInt64LE(zip64Extra, entry.size,  12); // compressed size
      writeUInt64LE(zip64Extra, entry.offset, 20); // relative offset of local header

      // Central directory file header (46 bytes)
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50,  0); // central directory signature
      header.writeUInt16LE(45,          4); // version made by: 4.5
      header.writeUInt16LE(45,          6); // version needed: 4.5
      header.writeUInt16LE(0x0800,      8); // flags: UTF-8
      header.writeUInt16LE(0,          10); // compression: STORED
      header.writeUInt16LE(0,          12); // mod time
      header.writeUInt16LE(0x21,       14); // mod date
      header.writeUInt32LE(entry.crc,  16); // CRC-32
      header.writeUInt32LE(0xFFFFFFFF, 20); // compressed size  → ZIP64
      header.writeUInt32LE(0xFFFFFFFF, 24); // uncompressed size → ZIP64
      header.writeUInt16LE(nameBuf.length, 28);
      header.writeUInt16LE(zip64Extra.length, 30);
      header.writeUInt16LE(0,          32); // file comment length
      header.writeUInt16LE(0xFFFF,     34); // disk number start → ZIP64
      header.writeUInt16LE(0,          36); // internal attributes
      header.writeUInt32LE(0,          38); // external attributes
      header.writeUInt32LE(0xFFFFFFFF, 42); // local header offset → ZIP64

      this.writeBuf(header);
      this.writeBuf(nameBuf);
      this.writeBuf(zip64Extra);
    }

    const centralDirSize: bigint = this.offset - centralDirStart;
    const entryCount = BigInt(this.entries.length);

    // ZIP64 end of central directory record (56 bytes)
    const zip64Eocd = Buffer.alloc(56);
    zip64Eocd.writeUInt32LE(0x06064b50, 0); // ZIP64 EOCD signature
    writeUInt64LE(zip64Eocd, 44n,             8);  // size of zip64 EOCD (56-12)
    zip64Eocd.writeUInt16LE(45,              16);  // version made by
    zip64Eocd.writeUInt16LE(45,              18);  // version needed
    zip64Eocd.writeUInt32LE(0,              20);   // disk number
    zip64Eocd.writeUInt32LE(0,              24);   // disk with start of central dir
    writeUInt64LE(zip64Eocd, entryCount,    28);   // entries on this disk
    writeUInt64LE(zip64Eocd, entryCount,    36);   // total entries
    writeUInt64LE(zip64Eocd, centralDirSize, 44);  // central dir size
    writeUInt64LE(zip64Eocd, centralDirStart, 52); // central dir offset
    this.writeBuf(zip64Eocd);

    // ZIP64 end of central directory locator (20 bytes)
    const zip64Locator = Buffer.alloc(20);
    zip64Locator.writeUInt32LE(0x07064b50, 0); // ZIP64 EOCD locator signature
    zip64Locator.writeUInt32LE(0,           4); // disk with start of zip64 EOCD
    writeUInt64LE(zip64Locator, centralDirStart + centralDirSize, 8); // offset of zip64 EOCD
    zip64Locator.writeUInt32LE(1,          16); // total disks
    this.writeBuf(zip64Locator);

    // End of central directory record (22 bytes) — fields set to 0xFFFF/0xFFFFFFFF → ZIP64
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50,  0); // EOCD signature
    eocd.writeUInt16LE(0xFFFF,      4); // disk number → ZIP64
    eocd.writeUInt16LE(0xFFFF,      6); // disk with central dir → ZIP64
    eocd.writeUInt16LE(0xFFFF,      8); // entries on this disk → ZIP64
    eocd.writeUInt16LE(0xFFFF,     10); // total entries → ZIP64
    eocd.writeUInt32LE(0xFFFFFFFF, 12); // central dir size → ZIP64
    eocd.writeUInt32LE(0xFFFFFFFF, 16); // central dir offset → ZIP64
    eocd.writeUInt16LE(0,          20); // comment length
    this.writeBuf(eocd);

    this.out.end();
  }
}
