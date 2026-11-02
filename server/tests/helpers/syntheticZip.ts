import { deflateRawSync } from 'node:zlib';

export type SyntheticZipPart = { name: string; data: Buffer; flags?: number; externalAttributes?: number; compressed?: boolean };

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function syntheticZip(parts: SyntheticZipPart[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name);
    const bytes = part.compressed ? deflateRawSync(part.data) : part.data;
    const method = part.compressed ? 8 : 0;
    const checksum = crc32(part.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(part.flags ?? 0, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(part.data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6); directory.writeUInt16LE(part.flags ?? 0, 8);
    directory.writeUInt16LE(method, 10); directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(part.data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(part.externalAttributes ?? 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + bytes.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
