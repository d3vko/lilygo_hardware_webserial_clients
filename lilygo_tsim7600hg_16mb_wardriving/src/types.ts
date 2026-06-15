export type ScanType = 'lte' | 'wifi' | 'ble';

export interface RawLogLine {
  id: number;
  text: string;
  receivedAt: string;
}

export interface LteRecord {
  source: 'lte';
  timestamp: string;
  technology: string;
  cellType: string;
  status: string;
  mcc: string;
  mnc: string;
  lac: string;
  cellId: string;
  eNodeB: string;
  sector: string;
  pci: string;
  band: string;
  earfcn: string;
  freqDlMhz: string;
  freqUlMhz: string;
  rssi: string;
  rsrp: string;
  rsrq: string;
  sinr: string;
  operator: string;
  longitude: string;
  latitude: string;
  capturedAt: string;
}

export interface WifiRecord {
  source: 'wifi';
  timestamp: string;
  latitude: string;
  longitude: string;
  ssid: string;
  bssid: string;
  channel: string;
  signal: string;
  security: string;
  capturedAt: string;
}

export interface BleRecord {
  source: 'ble';
  timestamp: string;
  latitude: string;
  longitude: string;
  address: string;
  rssi: string;
  name: string;
  capturedAt: string;
}

export type ScanRecord = LteRecord | WifiRecord | BleRecord;

export type ParsedSerialEvent =
  | { type: 'lte'; record: LteRecord; line: string }
  | { type: 'wifi'; record: WifiRecord; line: string }
  | { type: 'ble'; record: BleRecord; line: string }
  | { type: 'header'; scanType: ScanType; line: string }
  | { type: 'ignoredInvalidCoordinates'; scanType: ScanType; line: string; reason: string }
  | { type: 'log'; line: string };
