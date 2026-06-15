import type { BleRecord, LteRecord, ScanRecord, ScanType, WifiRecord } from './types';

const EXPORT_HEADERS: Record<ScanType, string[]> = {
  lte: [
    'Timestamp',
    'Tecnología',
    'TipoCelda',
    'Estado',
    'MCC',
    'MNC',
    'LAC',
    'CellID',
    'eNodeB',
    'Sector',
    'PCI',
    'Banda',
    'EARFCN',
    'FreqDL_MHz',
    'FreqUL_MHz',
    'RSSI',
    'RSRP',
    'RSRQ',
    'SINR',
    'Operador',
    'Longitud',
    'Latitud'
  ],
  wifi: ['Timestamp', 'Lat', 'Long', 'SSID', 'BSSID', 'Canal', 'Señal', 'Seguridad'],
  ble: ['Timestamp', 'Lat', 'Long', 'Dirección', 'RSSI', 'Nombre']
};

export function buildCsv(type: 'lte', rows: LteRecord[]): string;
export function buildCsv(type: 'wifi', rows: WifiRecord[]): string;
export function buildCsv(type: 'ble', rows: BleRecord[]): string;
export function buildCsv(type: ScanType, rows: ScanRecord[]): string;
export function buildCsv(type: ScanType, rows: ScanRecord[]): string {
  const header = EXPORT_HEADERS[type];
  const body = rows.map((row) => rowToCsvValues(row).map(escapeCsvValue).join(','));
  return [header.map(escapeCsvValue).join(','), ...body].join('\n');
}

export function makeCsvFilename(type: ScanType, date = new Date()): string {
  return `lilygo_${type}_${formatTimestamp(date)}.csv`;
}

export function downloadCsv(type: ScanType, rows: ScanRecord[]): void {
  const csv = buildCsv(type, rowsForType(type, rows));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = makeCsvFilename(type);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function escapeCsvValue(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function rowToCsvValues(row: ScanRecord): string[] {
  if (row.source === 'lte') {
    return [
      row.timestamp,
      row.technology,
      row.cellType,
      row.status,
      row.mcc,
      row.mnc,
      row.lac,
      row.cellId,
      row.eNodeB,
      row.sector,
      row.pci,
      row.band,
      row.earfcn,
      row.freqDlMhz,
      row.freqUlMhz,
      row.rssi,
      row.rsrp,
      row.rsrq,
      row.sinr,
      row.operator,
      row.longitude,
      row.latitude
    ];
  }

  if (row.source === 'wifi') {
    return [
      row.timestamp,
      row.latitude,
      row.longitude,
      row.ssid,
      row.bssid,
      row.channel,
      row.signal,
      row.security
    ];
  }

  return [row.timestamp, row.latitude, row.longitude, row.address, row.rssi, row.name];
}

function rowsForType(type: ScanType, rows: ScanRecord[]): ScanRecord[] {
  return rows.filter((row) => row.source === type);
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}
