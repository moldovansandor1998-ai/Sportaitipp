// Tréning-dataset készítés a jóváhagyott referenciafotókból (store-method ZIP, nincs tömörítés).
// A fal.ai flux-lora-fast-training `images_data_url` mezője várja data:application/zip;base64,… formában.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry { name: string; data: Buffer; }

// Valódi tartalom-azonosítás (magic bytes) – a training-prep és a unit-tesztek közös kódja
export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  return null;
}

// Audió magic byte-ok (TTS/tts export helyett a talking/lip-sync hangbemenetéhez)
export function sniffMedia(buf: Buffer): string | null {
  const img = sniffImage(buf);
  if (img) return img;
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "audio/mpeg";   // MP3 ID3
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";             // MP3 frame
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  return null;
}

export const TRAINING_LIMITS = {
  maxFiles: 40, minFiles: 3,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxZipBytes: 8 * 1024 * 1024,
};

/** Minimális, helyes ZIP (store method) – CRC32 és central directory nélkülözhetetlen mezőivel. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const now = dosDateTime(new Date());
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0x0800, 6);          // UTF-8 flag
    local.writeUInt16LE(0, 8);               // method: store
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);  // compressed = stored
    local.writeUInt32LE(e.data.length, 22);  // uncompressed
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);              // extra len
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 30);            // extra+comment len
    central.writeUInt16LE(0, 34);            // disk number
    central.writeUInt16LE(0, 36);            // internal attrs
    central.writeUInt32LE(0, 38);            // external attrs
    central.writeUInt32LE(offset, 42);       // local header offset
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

export function zipToDataUrl(zip: Buffer): string {
  return `data:application/zip;base64,${zip.toString("base64")}`;
}
