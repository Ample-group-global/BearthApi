import type { Writable } from "stream";

// Minimal streaming ZIP writer (STORED / uncompressed entries only) with no
// external dependency. Images are already PNG/WEBP-compressed, so DEFLATE
// would cost CPU for negligible size savings — STORED is valid per the ZIP
// spec (compression method 0) and opens fine in any standard zip tool.
//
// Capped for standard (non-ZIP64) use: callers must keep entry count under
// 65,535 and total archive size under 4GB, or offsets/sizes will overflow
// the 32-bit fields and silently corrupt the archive. See DOWNLOAD_ITEM_CAP
// in export.ts, which enforces this before streaming begins.

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

interface ZipEntryRecord {
  name: string;
  crc: number;
  size: number;
  offset: number;
}

export class ZipStream {
  private out: Writable;
  private offset = 0;
  private entries: ZipEntryRecord[] = [];

  constructor(out: Writable) {
    this.out = out;
  }

  private writeBuf(buf: Buffer) {
    this.out.write(buf);
    this.offset += buf.length;
  }

  addFile(name: string, data: Buffer) {
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, "utf8");
    const localHeaderOffset = this.offset;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);  // local file header signature
    header.writeUInt16LE(20, 4);          // version needed to extract
    header.writeUInt16LE(0x0800, 6);      // flags: UTF-8 filename
    header.writeUInt16LE(0, 8);           // compression method: stored
    header.writeUInt16LE(0, 10);          // mod time
    header.writeUInt16LE(0x21, 12);       // mod date (arbitrary valid value)
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); // compressed size
    header.writeUInt32LE(data.length, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);          // extra field length

    this.writeBuf(header);
    this.writeBuf(nameBuf);
    this.writeBuf(data);

    this.entries.push({ name, crc, size: data.length, offset: localHeaderOffset });
  }

  finish() {
    const centralDirStart = this.offset;
    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, "utf8");
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);  // central directory file header signature
      header.writeUInt16LE(20, 4);          // version made by
      header.writeUInt16LE(20, 6);          // version needed to extract
      header.writeUInt16LE(0x0800, 8);      // flags
      header.writeUInt16LE(0, 10);          // compression method: stored
      header.writeUInt16LE(0, 12);          // mod time
      header.writeUInt16LE(0x21, 14);       // mod date
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.size, 20); // compressed size
      header.writeUInt32LE(entry.size, 24); // uncompressed size
      header.writeUInt16LE(nameBuf.length, 28);
      header.writeUInt16LE(0, 30);          // extra field length
      header.writeUInt16LE(0, 32);          // file comment length
      header.writeUInt16LE(0, 34);          // disk number start
      header.writeUInt16LE(0, 36);          // internal file attributes
      header.writeUInt32LE(0, 38);          // external file attributes
      header.writeUInt32LE(entry.offset, 42);
      this.writeBuf(header);
      this.writeBuf(nameBuf);
    }
    const centralDirSize = this.offset - centralDirStart;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);         // end of central directory signature
    end.writeUInt16LE(0, 4);                  // disk number
    end.writeUInt16LE(0, 6);                  // disk with central directory
    end.writeUInt16LE(this.entries.length, 8);  // entries on this disk
    end.writeUInt16LE(this.entries.length, 10); // total entries
    end.writeUInt32LE(centralDirSize, 12);
    end.writeUInt32LE(centralDirStart, 16);
    end.writeUInt16LE(0, 20);                 // comment length
    this.writeBuf(end);

    this.out.end();
  }
}
