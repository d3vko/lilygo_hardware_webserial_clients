# LilyGO TSIM7000G Web Serial Client

Frontend client for reading LilyGO TSIM7000G serial output from the browser, classifying wardriving data into LTE, WiFi, and BLE sections, and exporting filtered CSV files.

The app is read-only over Web Serial. It connects to the device, streams logs, parses known CSV rows, ignores records with invalid or zero coordinates, and downloads one CSV per data type.

## Requirements

- Node.js 22 or newer.
- pnpm 10 or newer (`npm install -g pnpm`).
- Chrome, Edge, or another Chromium browser with Web Serial support.
- The app must run from `localhost` or HTTPS for Web Serial access.

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Open the local Vite URL in a Chromium browser, connect the LilyGO serial device, select the baud rate, and start reading incoming output.

Default baud rate:

```text
115200
```

## Build And Preview

```bash
pnpm build
pnpm preview
```

## Tests

```bash
pnpm test
```

The tests cover serial parsing, zero-coordinate filtering, chunk buffering, CSV escaping, and export filenames.

## CSV Exports

Rows where both latitude and longitude are zero-like values, such as `0`, `0.0`, or `0.0000000`, are ignored and are not saved.

WiFi export:

```csv
Timestamp,Lat,Long,SSID,BSSID,Canal,Señal,Seguridad
```

BLE export:

```csv
Timestamp,Lat,Long,Dirección,RSSI,Nombre
```

LTE export:

```csv
Timestamp,Tecnología,TipoCelda,Estado,MCC,MNC,LAC,CellID,eNodeB,Sector,PCI,Banda,EARFCN,FreqDL_MHz,FreqUL_MHz,RSSI,RSRP,RSRQ,SINR,Operador,Longitud,Latitud
```

The parser accepts both the legacy firmware format (16 serial columns) and the extended format (23 serial columns). Legacy rows fill the seven new columns (`TipoCelda`, `eNodeB`, `Sector`, `PCI`, `EARFCN`, `FreqDL_MHz`, `FreqUL_MHz`) with empty values in the exported CSV.

Downloaded filenames use this format:

```text
lilygo_wifi_YYYYMMDD_HHmmss.csv
lilygo_ble_YYYYMMDD_HHmmss.csv
lilygo_lte_YYYYMMDD_HHmmss.csv
```

## Browser Use

1. Run `pnpm dev`.
2. Open the Vite local URL in Chrome or Edge.
3. Click `Connect serial`.
4. Choose the LilyGO serial port.
5. Watch raw serial logs and parsed LTE, WiFi, and BLE tables.
6. Download the CSV file for each section when records are available.
