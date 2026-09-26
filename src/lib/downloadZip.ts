// Uncompressed ZIP: images are already compressed, so recompression adds little value.
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files: { name: string; bytes: ArrayBuffer }[]): Blob {
  if (files.length > 65535) throw new Error("Túl sok fájl a ZIP-hez.");
  const parts: BlobPart[] = [];
  const directory: BlobPart[] = [];
  const encoder = new TextEncoder();
  let offset = 0;
  let directorySize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const length = file.bytes.byteLength;
    if (length > 0xffffffff || offset + length + name.length + 30 > 0xffffffff)
      throw new Error("A kijelölt fájlok túl nagyok egy ZIP-hez.");
    const checksum = crc32(new Uint8Array(file.bytes));
    const local = new ArrayBuffer(30);
    const l = new DataView(local);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true); // UTF-8 names
    l.setUint32(14, checksum, true);
    l.setUint32(18, length, true);
    l.setUint32(22, length, true);
    l.setUint16(26, name.length, true);
    parts.push(local, name, file.bytes);

    const central = new ArrayBuffer(46);
    const d = new DataView(central);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint32(16, checksum, true);
    d.setUint32(20, length, true);
    d.setUint32(24, length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    directory.push(central, name);
    directorySize += 46 + name.length;
    offset += 30 + name.length + length;
  }
  const end = new ArrayBuffer(22);
  const e = new DataView(end);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
