import { describe, expect, it } from 'vitest';
import { BLE_HEADER, LTE_EXTENDED_HEADER, LTE_HEADER, parseSerialChunk, parseSerialLine, WIFI_HEADER } from './parser';

const capturedAt = '2026-04-10T23:52:01.000Z';

describe('parseSerialLine', () => {
  it('detects LTE, WiFi, and BLE headers', () => {
    expect(parseSerialLine(LTE_HEADER, capturedAt)).toEqual({ type: 'header', scanType: 'lte', line: LTE_HEADER });
    expect(parseSerialLine(LTE_EXTENDED_HEADER, capturedAt)).toEqual({ type: 'header', scanType: 'lte', line: LTE_EXTENDED_HEADER });
    expect(parseSerialLine(WIFI_HEADER, capturedAt)).toEqual({ type: 'header', scanType: 'wifi', line: WIFI_HEADER });
    expect(parseSerialLine(BLE_HEADER, capturedAt)).toEqual({ type: 'header', scanType: 'ble', line: BLE_HEADER });
  });

  it('parses a valid LTE legacy row', () => {
    const line = 'lte,,LTE,0,334,020,1201,390112,3,-73,-101,-10,9,Telcel,-99.1332090,19.4326080';
    const event = parseSerialLine(line, capturedAt);

    expect(event.type).toBe('lte');
    if (event.type === 'lte') {
      expect(event.line).toBe(line);
      expect(event.record.operator).toBe('Telcel');
      expect(event.record.longitude).toBe('-99.1332090');
      expect(event.record.latitude).toBe('19.4326080');
      expect(event.record.capturedAt).toBe(capturedAt);
      expect(event.record.cellType).toBe('');
      expect(event.record.eNodeB).toBe('');
      expect(event.record.pci).toBe('');
    }
  });

  it('parses a valid LTE extended row', () => {
    const line = 'lte,,LTE,FDD-LTE,0,334,020,1201,390112,6095,2,123,3,1300,2115.0,1920.0,-73,-101,-10,9,Telcel,-99.1332090,19.4326080';
    const event = parseSerialLine(line, capturedAt);

    expect(event.type).toBe('lte');
    if (event.type === 'lte') {
      expect(event.record.technology).toBe('LTE');
      expect(event.record.cellType).toBe('FDD-LTE');
      expect(event.record.mcc).toBe('334');
      expect(event.record.cellId).toBe('390112');
      expect(event.record.eNodeB).toBe('6095');
      expect(event.record.sector).toBe('2');
      expect(event.record.pci).toBe('123');
      expect(event.record.band).toBe('3');
      expect(event.record.earfcn).toBe('1300');
      expect(event.record.freqDlMhz).toBe('2115.0');
      expect(event.record.freqUlMhz).toBe('1920.0');
      expect(event.record.rssi).toBe('-73');
      expect(event.record.rsrp).toBe('-101');
      expect(event.record.rsrq).toBe('-10');
      expect(event.record.sinr).toBe('9');
      expect(event.record.operator).toBe('Telcel');
      expect(event.record.longitude).toBe('-99.1332090');
      expect(event.record.latitude).toBe('19.4326080');
      expect(event.record.capturedAt).toBe(capturedAt);
    }
  });

  it('parses a valid WiFi row with an empty SSID', () => {
    const line = 'wifi,,19.4326080,-99.1332090,,A2:31:DB:A0:CC:C6,7,-73,WPA2_PSK';
    const event = parseSerialLine(line, capturedAt);

    expect(event.type).toBe('wifi');
    if (event.type === 'wifi') {
      expect(event.record.ssid).toBe('');
      expect(event.record.bssid).toBe('A2:31:DB:A0:CC:C6');
      expect(event.record.security).toBe('WPA2_PSK');
    }
  });

  it('parses a valid BLE row', () => {
    const line = 'ble,,19.4326080,-99.1332090,80:E1:26:76:33:64,-65,d3vnull0';
    const event = parseSerialLine(line, capturedAt);

    expect(event.type).toBe('ble');
    if (event.type === 'ble') {
      expect(event.record.address).toBe('80:E1:26:76:33:64');
      expect(event.record.name).toBe('d3vnull0');
    }
  });

  it('rejects zero-coordinate rows for every scan type', () => {
    expect(parseSerialLine('lte,,LTE,0,0,0,0,0,0,0,0,0,0,,0.0000000,0.0000000', capturedAt)).toMatchObject({
      type: 'ignoredInvalidCoordinates',
      scanType: 'lte'
    });
    expect(parseSerialLine('lte,,LTE,FDD-LTE,0,0,0,0,0,0,0,0,0,0,0.0,0.0,0,0,0,0,,0.0000000,0.0000000', capturedAt)).toMatchObject({
      type: 'ignoredInvalidCoordinates',
      scanType: 'lte'
    });
    expect(parseSerialLine('wifi,,0.0000000,0.0000000,Home,18:A6:F7:BF:71:72,2,-57,WPA_WPA2_PSK', capturedAt)).toMatchObject({
      type: 'ignoredInvalidCoordinates',
      scanType: 'wifi'
    });
    expect(parseSerialLine('ble,,0.0000000,0.0000000,80:E1:26:76:33:64,-65,d3vnull0', capturedAt)).toMatchObject({
      type: 'ignoredInvalidCoordinates',
      scanType: 'ble'
    });
  });

  it('classifies status and ESP warning lines as logs', () => {
    expect(parseSerialLine('[modem] AT sync OK', capturedAt)).toEqual({ type: 'log', line: '[modem] AT sync OK' });
    expect(parseSerialLine('[ 18793][W][sd_diskio.cpp:104] sdWait(): Wait Failed', capturedAt)).toEqual({
      type: 'log',
      line: '[ 18793][W][sd_diskio.cpp:104] sdWait(): Wait Failed'
    });
  });
});

describe('parseSerialChunk', () => {
  it('buffers partial lines across chunks', () => {
    const first = parseSerialChunk('wifi,,19.4326080,-99.1332090,Network', '', capturedAt);
    expect(first.events).toEqual([]);
    expect(first.carry).toBe('wifi,,19.4326080,-99.1332090,Network');

    const second = parseSerialChunk(',AA:BB:CC:DD:EE:FF,11,-53,WPA2_PSK\n[ble] logged 1 devices\n', first.carry, capturedAt);
    expect(second.carry).toBe('');
    expect(second.events.map((event) => event.type)).toEqual(['wifi', 'log']);
  });
});
