import { describe, expect, test } from '@jest/globals';
import { deflateRawSync } from 'node:zlib';
import { inspectInboundZip, InboundZipInspectionError } from '../services/inboundOrders/inboundZipInspection';

type ZipPart = { name: string; data: Buffer; flags?: number; externalAttributes?: number; compressed?: boolean };

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(parts: ZipPart[]): Buffer {
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

describe('bounded inbound ZIP inspection', () => {
  test('returns supported files and a rejected manifest entry without reading it', async () => {
    const archive = zip([
      { name: 'front.pdf', data: Buffer.from('%PDF-1.7 front') },
      { name: 'back.png', data: Buffer.from('image bytes') },
      { name: 'notes.exe', data: Buffer.from('unsupported') },
    ]);
    const result = await inspectInboundZip(archive);
    expect(result.entries.map((entry) => [entry.filename, entry.supported, entry.suggestedRole])).toEqual([
      ['front.pdf', true, 'artwork'], ['back.png', true, 'artwork'], ['notes.exe', false, 'reference'],
    ]);
    expect(result.buffers.size).toBe(2);
    expect(result.buffers.get(result.entries[0].id)?.toString()).toBe('%PDF-1.7 front');
    expect(result.entries[2].reason).toMatch(/not supported/i);
  });

  test.each([
    [{ name: '../escape.pdf', data: Buffer.from('bad') }],
    [{ name: 'link.pdf', data: Buffer.from('target'), externalAttributes: (0xa000 << 16) >>> 0 }],
    [{ name: 'encrypted.pdf', data: Buffer.from('bad'), flags: 1 }],
  ])('rejects unsafe paths, links, and encrypted entries', async (part) => {
    await expect(inspectInboundZip(zip([part]))).rejects.toBeInstanceOf(InboundZipInspectionError);
  });

  test('rejects a compression bomb and lists nested archives as unsupported', async () => {
    await expect(inspectInboundZip(zip([{ name: 'large.pdf', data: Buffer.alloc(100_000, 65), compressed: true }])))
      .rejects.toThrow(/compression ratio/i);
    const nested = await inspectInboundZip(zip([{ name: 'nested.zip', data: Buffer.from('PK') }]));
    expect(nested.entries[0].supported).toBe(false);
    expect(nested.entries[0].reason).toMatch(/nested archive/i);
    expect(nested.buffers.size).toBe(0);
  });

  test('fails closed when a supported entry cannot be extracted', async () => {
    const corrupt = zip([{ name: 'front.pdf', data: Buffer.from('%PDF-1.7 synthetic content'), compressed: true }]);
    corrupt[30 + Buffer.byteLength('front.pdf')] = 0xff;
    await expect(inspectInboundZip(corrupt)).rejects.toBeInstanceOf(InboundZipInspectionError);
  });
});
