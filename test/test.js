const assert = require('assert');
const KLV = require('../KLVParser.js');

const KEY = '060e2b34020b01010e01030101000000';

// Build an ST 0601 packet from items, with a correct (or deliberately wrong) checksum
function packet(items, { badChecksum = false } = {}) {
  const body = Buffer.concat([...items.map((i) => Buffer.from(i, 'hex')), Buffer.from('0102', 'hex')]);
  const len = body.length + 2;
  const ber = len < 128 ? Buffer.from([len]) : Buffer.from([0x82, len >> 8, len & 0xff]);
  const head = Buffer.concat([Buffer.from(KEY, 'hex'), ber]);
  const bytes = Buffer.concat([head, body]);
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i] << (8 * ((i + 1) % 2));
  sum = (sum + (badChecksum ? 1 : 0)) & 0xffff;
  return Buffer.concat([bytes, Buffer.from([sum >> 8, sum & 0xff])]);
}

const timestamp = '0208000459f4a6aa4aa8';
const latitude = '0d045595b66d'; // 60.176822966978335
const version = '410113';
// Take-off Time, tag 131: a two-byte BER-OID tag (0x81 0x03)
const takeOff = '8103' + '08' + '000459f4a6aa4aa8';

// 1. A tag above 127 no longer misaligns the packet
let r = KLV.parseKLVfile(packet([timestamp, takeOff, latitude, version]));
assert.strictEqual(r.packets.length, 1, 'packet with tag 131 parses');
assert.strictEqual(r.packets[0].takeOffTime, 1224807209913);
assert.ok(Math.abs(r.packets[0].sensorLatitude - 60.176822966978335) < 1e-9);

// 2. A packet at an odd offset in the buffer passes the checksum
r = KLV.parseKLVfile(Buffer.concat([Buffer.from([0]), packet([timestamp, latitude, version])]));
assert.strictEqual(r.packets.length, 1, 'packet at odd offset parses');
assert.strictEqual(r.nDropped, 0);

// 3. A packet with a wrong checksum is dropped
r = KLV.parseKLVfile(packet([timestamp, latitude, version], { badChecksum: true }));
assert.strictEqual(r.packets.length, 0, 'bad checksum is dropped');
assert.strictEqual(r.nDropped, 1);

// 4. Long-form item length (0x81 0x80): a 128-byte Mission ID
const missionId = '03' + '8180' + Buffer.alloc(128, 0x41).toString('hex');
const big = packet([timestamp, missionId, latitude, version]);
r = KLV.parseKLVfile(big);
assert.strictEqual(r.packets.length, 1, 'long-form item length parses');
assert.ok(Math.abs(r.packets[0].sensorLatitude - 60.176822966978335) < 1e-9);

console.log('all tests passed');
