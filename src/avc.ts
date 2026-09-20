// Check the AVCDecoderConfigurationRecord supplied by a browser encoder before
// trusting it in an MP4. Some encoders duplicate the SPS/PPS NAL header bytes:
// players may recover from in-band headers, while upload services reject it.
export function validAvcDescription(description: AllowSharedBufferSource): boolean {
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  if (bytes.length < 7 || bytes[0] !== 1 || (bytes[4] & 0xfc) !== 0xfc
    || (bytes[4] & 3) === 2 || (bytes[5] & 0xe0) !== 0xe0) return false;
  let offset = 6;
  const readSets = (count: number, type: number) => {
    if (!count) return false;
    for (let i = 0; i < count; i++) {
      if (offset + 2 > bytes.length) return false;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      offset += 2;
      if (length < (type === 7 ? 4 : 2) || offset + length > bytes.length
        || (bytes[offset] & 0x9f) !== type) return false;
      // The record's profile, compatibility and level describe its first SPS.
      if (type === 7 && i === 0 && (bytes[offset + 1] !== bytes[1]
        || bytes[offset + 2] !== bytes[2] || bytes[offset + 3] !== bytes[3])) return false;
      offset += length;
    }
    return true;
  };
  if (!readSets(bytes[5] & 0x1f, 7) || offset >= bytes.length) return false;
  return readSets(bytes[offset++], 8);
}
