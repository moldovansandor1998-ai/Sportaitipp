import "server-only";
import sharp from "sharp";

/** 64-bit difference hash catches common resized/re-encoded copies before upload. */
export async function imagePerceptualHash(bytes: Buffer): Promise<string> {
  const pixels = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
    .resize(9, 8, { fit: "fill" }).removeAlpha().grayscale().raw().toBuffer();
  let hash = 0n;
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
    hash = (hash << 1n) | BigInt(pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? 1 : 0);
  }
  return hash.toString(16).padStart(16, "0");
}

export function similarImageHashes(left: string, right: string, maximumDistance = 4): boolean {
  if (!/^[0-9a-f]{16}$/i.test(left) || !/^[0-9a-f]{16}$/i.test(right)) return false;
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`), count = 0;
  while (difference) { difference &= difference - 1n; count++; }
  return count <= maximumDistance;
}
