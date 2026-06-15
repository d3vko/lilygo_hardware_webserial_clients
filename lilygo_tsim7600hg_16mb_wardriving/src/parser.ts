import type { BleRecord, LteRecord, ParsedSerialEvent, ScanType, WifiRecord } from './types';

export const LTE_HEADER =
  'Source,Timestamp,Tecnología,Estado,MCC,MNC,LAC,CellID,Banda,RSSI,RSRP,RSRQ,SINR,Operador,Longitud,Latitud';
export const LTE_EXTENDED_HEADER =
  'Source,Timestamp,Tecnología,TipoCelda,Estado,MCC,MNC,LAC,CellID,eNodeB,Sector,PCI,Banda,EARFCN,FreqDL_MHz,FreqUL_MHz,RSSI,RSRP,RSRQ,SINR,Operador,Longitud,Latitud';
export const WIFI_HEADER = 'Source,Timestamp,Lat,Long,SSID,BSSID,Canal,Señal,Seguridad';
export const BLE_HEADER = 'Source,Timestamp,Lat,Long,Dirección,RSSI,Nombre';

const LTE_HEADERS = new Set([LTE_HEADER, LTE_EXTENDED_HEADER]);

const HEADER_BY_TYPE: Record<ScanType, string> = {
  lte: LTE_HEADER,
  wifi: WIFI_HEADER,
  ble: BLE_HEADER
};

export function parseSerialLine(line: string, capturedAt = new Date().toISOString()): ParsedSerialEvent {
  const trimmed = line.trim();

  if (!trimmed) {
    return { type: 'log', line };
  }

  const headerType = headerForLine(trimmed);
  if (headerType) {
    return { type: 'header', scanType: headerType, line: trimmed };
  }

  const fields = parseCsvLine(trimmed);
  const source = fields[0]?.toLowerCase();

  if (source === 'lte') {
    return parseLte(fields, trimmed, capturedAt);
  }

  if (source === 'wifi') {
    return parseWifi(fields, trimmed, capturedAt);
  }

  if (source === 'ble') {
    return parseBle(fields, trimmed, capturedAt);
  }

  return { type: 'log', line };
}

export function parseSerialChunk(
  chunk: string,
  carry = '',
  capturedAt = new Date().toISOString()
): { events: ParsedSerialEvent[]; carry: string } {
  const normalized = `${carry}${chunk}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  const nextCarry = parts.pop() ?? '';

  return {
    events: parts.map((line) => parseSerialLine(line, capturedAt)),
    carry: nextCarry
  };
}

export function flushSerialCarry(carry: string, capturedAt = new Date().toISOString()): ParsedSerialEvent[] {
  return carry ? [parseSerialLine(carry, capturedAt)] : [];
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function headerForLine(line: string): ScanType | null {
  const normalized = line.trim();
  if (LTE_HEADERS.has(normalized)) return 'lte';
  const match = Object.entries(HEADER_BY_TYPE).find(([, header]) => header === normalized);
  return match ? (match[0] as ScanType) : null;
}

function parseLte(fields: string[], line: string, capturedAt: string): ParsedSerialEvent {
  // Detect extended format by field count: 23 columns (with Source) vs 16 legacy.
  if (fields.length >= 20) {
    return parseLteExtended(fields, line, capturedAt);
  }
  return parseLteLegacy(fields, line, capturedAt);
}

function parseLteLegacy(fields: string[], line: string, capturedAt: string): ParsedSerialEvent {
  const longitude = fields[14] ?? '';
  const latitude = fields[15] ?? '';

  if (!hasUsableCoordinates(latitude, longitude)) {
    return invalidCoordinates('lte', line);
  }

  const record: LteRecord = {
    source: 'lte',
    timestamp: fields[1] ?? '',
    technology: fields[2] ?? '',
    cellType: '',
    status: fields[3] ?? '',
    mcc: fields[4] ?? '',
    mnc: fields[5] ?? '',
    lac: fields[6] ?? '',
    cellId: fields[7] ?? '',
    eNodeB: '',
    sector: '',
    pci: '',
    band: fields[8] ?? '',
    earfcn: '',
    freqDlMhz: '',
    freqUlMhz: '',
    rssi: fields[9] ?? '',
    rsrp: fields[10] ?? '',
    rsrq: fields[11] ?? '',
    sinr: fields[12] ?? '',
    operator: fields[13] ?? '',
    longitude,
    latitude,
    capturedAt
  };

  return { type: 'lte', record, line };
}

function parseLteExtended(fields: string[], line: string, capturedAt: string): ParsedSerialEvent {
  const longitude = fields[21] ?? '';
  const latitude = fields[22] ?? '';

  if (!hasUsableCoordinates(latitude, longitude)) {
    return invalidCoordinates('lte', line);
  }

  const record: LteRecord = {
    source: 'lte',
    timestamp: fields[1] ?? '',
    technology: fields[2] ?? '',
    cellType: fields[3] ?? '',
    status: fields[4] ?? '',
    mcc: fields[5] ?? '',
    mnc: fields[6] ?? '',
    lac: fields[7] ?? '',
    cellId: fields[8] ?? '',
    eNodeB: fields[9] ?? '',
    sector: fields[10] ?? '',
    pci: fields[11] ?? '',
    band: fields[12] ?? '',
    earfcn: fields[13] ?? '',
    freqDlMhz: fields[14] ?? '',
    freqUlMhz: fields[15] ?? '',
    rssi: fields[16] ?? '',
    rsrp: fields[17] ?? '',
    rsrq: fields[18] ?? '',
    sinr: fields[19] ?? '',
    operator: fields[20] ?? '',
    longitude,
    latitude,
    capturedAt
  };

  return { type: 'lte', record, line };
}

function parseWifi(fields: string[], line: string, capturedAt: string): ParsedSerialEvent {
  const latitude = fields[2] ?? '';
  const longitude = fields[3] ?? '';

  if (!hasUsableCoordinates(latitude, longitude)) {
    return invalidCoordinates('wifi', line);
  }

  const record: WifiRecord = {
    source: 'wifi',
    timestamp: fields[1] ?? '',
    latitude,
    longitude,
    ssid: fields[4] ?? '',
    bssid: fields[5] ?? '',
    channel: fields[6] ?? '',
    signal: fields[7] ?? '',
    security: fields[8] ?? '',
    capturedAt
  };

  return { type: 'wifi', record, line };
}

function parseBle(fields: string[], line: string, capturedAt: string): ParsedSerialEvent {
  const latitude = fields[2] ?? '';
  const longitude = fields[3] ?? '';

  if (!hasUsableCoordinates(latitude, longitude)) {
    return invalidCoordinates('ble', line);
  }

  const record: BleRecord = {
    source: 'ble',
    timestamp: fields[1] ?? '',
    latitude,
    longitude,
    address: fields[4] ?? '',
    rssi: fields[5] ?? '',
    name: fields[6] ?? '',
    capturedAt
  };

  return { type: 'ble', record, line };
}

function invalidCoordinates(scanType: ScanType, line: string): ParsedSerialEvent {
  return {
    type: 'ignoredInvalidCoordinates',
    scanType,
    line,
    reason: 'Latitude and longitude are missing, invalid, or both zero.'
  };
}

function hasUsableCoordinates(latitude: string, longitude: string): boolean {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return false;
  }

  return !(lat === 0 && lon === 0);
}
