import { describe, expect, it } from 'vitest';
import { buildCsv, escapeCsvValue, makeCsvFilename } from './csv';
import type { BleRecord, LteRecord, WifiRecord } from './types';

const capturedAt = '2026-04-10T23:52:01.000Z';

describe('buildCsv', () => {
  it('exports WiFi rows with headers and escaped values', () => {
    const rows: WifiRecord[] = [
      {
        source: 'wifi',
        timestamp: '',
        latitude: '19.4326080',
        longitude: '-99.1332090',
        ssid: 'Cafe, "Centro"',
        bssid: '34:6B:46:EC:BA:0B',
        channel: '11',
        signal: '-53',
        security: 'WPA2_PSK',
        capturedAt
      }
    ];

    expect(buildCsv('wifi', rows)).toBe(
      [
        'Timestamp,Lat,Long,SSID,BSSID,Canal,Señal,Seguridad',
        ',19.4326080,-99.1332090,"Cafe, ""Centro""",34:6B:46:EC:BA:0B,11,-53,WPA2_PSK'
      ].join('\n')
    );
  });

  it('exports BLE rows without internal Source or CapturedAt fields', () => {
    const rows: BleRecord[] = [
      {
        source: 'ble',
        timestamp: '',
        latitude: '19.4326080',
        longitude: '-99.1332090',
        address: '80:E1:26:76:33:64',
        rssi: '-65',
        name: 'd3vnull0',
        capturedAt
      }
    ];

    expect(buildCsv('ble', rows)).toBe(
      [
        'Timestamp,Lat,Long,Dirección,RSSI,Nombre',
        ',19.4326080,-99.1332090,80:E1:26:76:33:64,-65,d3vnull0'
      ].join('\n')
    );
  });

  it('exports LTE legacy rows with extended columns empty', () => {
    const rows: LteRecord[] = [
      {
        source: 'lte',
        timestamp: '',
        technology: 'LTE',
        cellType: '',
        status: '0',
        mcc: '334',
        mnc: '020',
        lac: '1201',
        cellId: '390112',
        eNodeB: '',
        sector: '',
        pci: '',
        band: '3',
        earfcn: '',
        freqDlMhz: '',
        freqUlMhz: '',
        rssi: '-73',
        rsrp: '-101',
        rsrq: '-10',
        sinr: '9',
        operator: '',
        longitude: '-99.1332090',
        latitude: '19.4326080',
        capturedAt
      }
    ];

    expect(buildCsv('lte', rows).split('\n')[0]).toBe(
      'Timestamp,Tecnología,TipoCelda,Estado,MCC,MNC,LAC,CellID,eNodeB,Sector,PCI,Banda,EARFCN,FreqDL_MHz,FreqUL_MHz,RSSI,RSRP,RSRQ,SINR,Operador,Longitud,Latitud'
    );
    expect(buildCsv('lte', rows).split('\n')[1]).toBe(
      ',LTE,,0,334,020,1201,390112,,,,3,,,,-73,-101,-10,9,,-99.1332090,19.4326080'
    );
  });

  it('exports LTE extended rows with all columns populated', () => {
    const rows: LteRecord[] = [
      {
        source: 'lte',
        timestamp: '',
        technology: 'LTE',
        cellType: 'FDD-LTE',
        status: '0',
        mcc: '334',
        mnc: '020',
        lac: '1201',
        cellId: '390112',
        eNodeB: '6095',
        sector: '2',
        pci: '123',
        band: '3',
        earfcn: '1300',
        freqDlMhz: '2115.0',
        freqUlMhz: '1920.0',
        rssi: '-73',
        rsrp: '-101',
        rsrq: '-10',
        sinr: '9',
        operator: 'Telcel',
        longitude: '-99.1332090',
        latitude: '19.4326080',
        capturedAt
      }
    ];

    expect(buildCsv('lte', rows).split('\n')[1]).toBe(
      ',LTE,FDD-LTE,0,334,020,1201,390112,6095,2,123,3,1300,2115.0,1920.0,-73,-101,-10,9,Telcel,-99.1332090,19.4326080'
    );
  });
});

describe('CSV helpers', () => {
  it('escapes commas, quotes, and newlines', () => {
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('a"b')).toBe('"a""b"');
    expect(escapeCsvValue('a\nb')).toBe('"a\nb"');
  });

  it('builds timestamped filenames', () => {
    expect(makeCsvFilename('ble', new Date(2026, 3, 10, 23, 52, 1))).toBe('lilygo_ble_20260410_235201.csv');
  });
});
