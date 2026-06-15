<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { buildCsv, makeCsvFilename } from './csv';
import { flushSerialCarry, parseSerialChunk, parseSerialLine } from './parser';
import type { BleRecord, LteRecord, ParsedSerialEvent, RawLogLine, ScanType, WifiRecord } from './types';
import {
  ApiConfigError,
  login as apiLogin,
  register as apiRegister,
  requestPasswordReset as apiRequestReset,
  refreshToken as apiRefreshToken,
  uploadCsv as apiUploadCsv,
} from './api';

type SerialSignalMode = 'dtrOffRtsOff' | 'dtrOnRtsOff' | 'dtrOnRtsOn';

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const serialSignalModes: { value: SerialSignalMode; label: string; signals: SerialOutputSignals }[] = [
  { value: 'dtrOffRtsOff', label: 'DTR off / RTS off', signals: { dataTerminalReady: false, requestToSend: false } },
  { value: 'dtrOnRtsOff', label: 'DTR on / RTS off', signals: { dataTerminalReady: true, requestToSend: false } },
  { value: 'dtrOnRtsOn', label: 'DTR on / RTS on', signals: { dataTerminalReady: true, requestToSend: true } }
];
const targetUsbSerialFilter: SerialPortFilter = { usbVendorId: 0x1a86, usbProductId: 0x55d4 };
const fallbackUsbSerialFilters: SerialPortFilter[] = [
  { usbVendorId: 0x10c4 },
  { usbVendorId: 0x1a86 },
  { usbVendorId: 0x0403 }
];
const maxRawLines = 1000;
const AUTH_STORAGE_KEY = 'wardrive-auth';
const isSerialSupported = computed(() => 'serial' in navigator && Boolean(navigator.serial));

const baudRate = ref(115200);
const serialSignalMode = ref<SerialSignalMode>('dtrOffRtsOff');
const isConnected = ref(false);
const isConnecting = ref(false);
const statusMessage = ref('Disconnected');
const errorMessage = ref('');
const ignoredCount = ref(0);
const rawLogs = ref<RawLogLine[]>([]);
const lteRows = ref<LteRecord[]>([]);
const wifiRows = ref<WifiRecord[]>([]);
const bleRows = ref<BleRecord[]>([]);
const terminalRef = ref<HTMLElement | null>(null);
const colorMode = ref<'white' | 'black'>(getInitialColorMode());
const selectedPortLabel = ref('');

let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;
let readCarry = '';
let rawLogId = 0;
let isDisconnecting = false;
let isTearingDown = false;
let pendingUploadAll = false;

const lteFilename = computed(() => makeCsvFilename('lte'));
const wifiFilename = computed(() => makeCsvFilename('wifi'));
const bleFilename = computed(() => makeCsvFilename('ble'));
const colorModeLabel = computed(() => (colorMode.value === 'black' ? 'White mode' : 'Black mode'));
const selectedSignalMode = computed(() => signalModeForValue(serialSignalMode.value));

const authToken = ref<string | null>(null);
const authRefreshToken = ref<string | null>(null);
const authUsername = ref<string | null>(null);
const isLoggedIn = computed(() => Boolean(authToken.value));

const showAuthModal = ref(false);
const authView = ref<'login' | 'register' | 'forgot'>('login');
const authFormUsername = ref('');
const authFormEmail = ref('');
const authFormPassword = ref('');
const authFormPasswordConfirm = ref('');
const authFormError = ref('');
const authFormSuccess = ref('');
const isAuthSubmitting = ref(false);

const uploadStatus = ref<Record<ScanType, 'idle' | 'uploading' | 'ok' | 'error'>>({ lte: 'idle', wifi: 'idle', ble: 'idle' });
const uploadErrorMsg = ref<Record<ScanType, string>>({ lte: '', wifi: '', ble: '' });
const isUploading = ref(false);
const hasAnyRows = computed(() => lteRows.value.length > 0 || wifiRows.value.length > 0 || bleRows.value.length > 0);
const uploadSummary = computed(() => {
  const parts: string[] = [];
  const labels: Record<ScanType, string> = { ble: 'BLE', wifi: 'WiFi', lte: 'LTE' };
  for (const type of (['ble', 'wifi', 'lte'] as ScanType[])) {
    const st = uploadStatus.value[type];
    if (st === 'ok') parts.push(`${labels[type]} ✓`);
    else if (st === 'error') parts.push(`${labels[type]}: ${uploadErrorMsg.value[type]}`);
    else if (st === 'uploading') parts.push(`${labels[type]} …`);
  }
  return parts.join(' · ');
});

watch(
  colorMode,
  (mode) => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem('lilygo-tsim7600hg-color-mode', mode);
  },
  { immediate: true }
);

function getInitialColorMode(): 'white' | 'black' {
  const saved = localStorage.getItem('lilygo-tsim7600hg-color-mode');

  if (saved === 'white' || saved === 'black') {
    return saved;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'black' : 'white';
}

function toggleColorMode(): void {
  colorMode.value = colorMode.value === 'black' ? 'white' : 'black';
}

onMounted(() => {
  loadStoredAuth();
  navigator.serial?.addEventListener('connect', handleSerialConnect);
  navigator.serial?.addEventListener('disconnect', handleSerialDisconnect);
});

onUnmounted(() => {
  navigator.serial?.removeEventListener('connect', handleSerialConnect);
  navigator.serial?.removeEventListener('disconnect', handleSerialDisconnect);
});

async function connectSerial(): Promise<void> {
  await connectSerialPort('target');
}

async function connectFallbackSerial(): Promise<void> {
  await connectSerialPort('usbFallback');
}

async function connectAnySerial(): Promise<void> {
  await connectSerialPort('all');
}

async function connectSerialPort(mode: 'target' | 'usbFallback' | 'all'): Promise<void> {
  if (!navigator.serial) {
    errorMessage.value = 'Web Serial is not available in this browser. Use Chrome or Edge over HTTPS or localhost.';
    return;
  }

  isTearingDown = false;
  isDisconnecting = false;
  isConnecting.value = true;
  errorMessage.value = '';
  statusMessage.value = statusForRequestMode(mode);

  try {
    port = await navigator.serial.requestPort(requestOptionsForMode(mode));
    selectedPortLabel.value = formatPortInfo(port.getInfo());
    await port.open({ baudRate: baudRate.value });
    await applySerialSignals(port);

    if (!port.readable) {
      throw new Error('The selected serial port is not readable.');
    }

    isConnected.value = true;
    statusMessage.value = `Connected at ${baudRate.value} baud (${selectedPortLabel.value})`;
    appendRawLog(`[serial] connected ${selectedPortLabel.value}`);
    appendRawLog(`[serial] control signals: ${selectedSignalMode.value.label}`);
    startReadLoop(port);
  } catch (error) {
    const message = serialErrorMessage(error);
    errorMessage.value = message;
    statusMessage.value = 'Disconnected';
    await closePort();
  } finally {
    isConnecting.value = false;
  }
}

async function disconnectSerial(): Promise<void> {
  isDisconnecting = true;
  statusMessage.value = 'Disconnecting...';
  errorMessage.value = '';
  await releaseSerialConnection('user');
}

async function releaseSerialConnection(reason: 'user' | 'lost' | 'error', error?: unknown): Promise<void> {
  if (isTearingDown) return;
  isTearingDown = true;

  try {
    await reader?.cancel();
  } catch {
    // reader may already be closed or released
  }

  reader?.releaseLock();
  reader = null;
  readCarry = '';
  await closePort();

  isConnected.value = false;
  isConnecting.value = false;
  isDisconnecting = false;
  selectedPortLabel.value = '';

  if (reason === 'user') {
    errorMessage.value = '';
    statusMessage.value = 'Disconnected';
  } else if (reason === 'lost') {
    errorMessage.value =
      'The TSIM 7600H-G serial device was lost. Reconnect the USB cable or reset the board, close other serial monitors, then connect again.';
    statusMessage.value = 'Device lost';
  } else {
    errorMessage.value = error !== undefined ? serialErrorMessage(error) : '';
    statusMessage.value = 'Disconnected';
  }
}

function startReadLoop(activePort: SerialPort): void {
  const decoder = new TextDecoderStream();
  const decoderWritable = decoder.writable as WritableStream<Uint8Array>;
  const inputClosed = activePort.readable?.pipeTo(decoderWritable).catch((error: unknown) => {
    if (!isDisconnecting && !isTearingDown) {
      errorMessage.value = serialErrorMessage(error);
    }
  });

  reader = decoder.readable.getReader();
  void readLoop(inputClosed);
}

async function readLoop(inputClosed?: Promise<void>): Promise<void> {
  let readError: unknown;

  try {
    while (reader) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        consumeChunk(value);
      }
    }
  } catch (error) {
    readError = error;
  } finally {
    consumeEvents(flushSerialCarry(readCarry));
    readCarry = '';
    reader?.releaseLock();
    reader = null;
    await inputClosed?.catch(() => undefined);

    if (!isTearingDown && !isDisconnecting) {
      await releaseSerialConnection(readError !== undefined ? 'error' : 'lost', readError);
    }
  }
}

function consumeChunk(chunk: string): void {
  const parsed = parseSerialChunk(chunk, readCarry);
  readCarry = parsed.carry;
  consumeEvents(parsed.events);
}

function consumeEvents(events: ParsedSerialEvent[]): void {
  for (const event of events) {
    if (event.type === 'lte') {
      lteRows.value.unshift(event.record);
    } else if (event.type === 'wifi') {
      wifiRows.value.unshift(event.record);
    } else if (event.type === 'ble') {
      bleRows.value.unshift(event.record);
    } else if (event.type === 'ignoredInvalidCoordinates') {
      ignoredCount.value += 1;
    }

    appendRawLog(lineForEvent(event));
  }
}

function lineForEvent(event: ParsedSerialEvent): string {
  if (event.type === 'log' || event.type === 'header' || event.type === 'ignoredInvalidCoordinates') {
    return event.line;
  }
  return event.line;
}

function appendRawLog(text: string): void {
  rawLogs.value.push({
    id: rawLogId,
    text,
    receivedAt: new Date().toLocaleTimeString()
  });
  rawLogId += 1;

  if (rawLogs.value.length > maxRawLines) {
    rawLogs.value.splice(0, rawLogs.value.length - maxRawLines);
  }

  void nextTick(() => {
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight;
    }
  });
}

async function closePort(): Promise<void> {
  try {
    await port?.close();
  } catch {
    // The read loop may already have closed or detached the port.
  } finally {
    port = null;
  }
}

function requestOptionsForMode(mode: 'target' | 'usbFallback' | 'all'): SerialPortRequestOptions | undefined {
  if (mode === 'target') {
    return { filters: [targetUsbSerialFilter] };
  }

  if (mode === 'usbFallback') {
    return { filters: fallbackUsbSerialFilters };
  }

  return undefined;
}

function statusForRequestMode(mode: 'target' | 'usbFallback' | 'all'): string {
  if (mode === 'target') {
    return 'Requesting TSIM 7600H-G USB serial port...';
  }

  if (mode === 'usbFallback') {
    return 'Requesting common USB serial port...';
  }

  return 'Requesting any serial port...';
}

async function applySerialSignals(activePort: SerialPort): Promise<void> {
  await activePort.setSignals(selectedSignalMode.value.signals);
}

function signalModeForValue(value: SerialSignalMode): { value: SerialSignalMode; label: string; signals: SerialOutputSignals } {
  return serialSignalModes.find((mode) => mode.value === value) ?? serialSignalModes[0];
}

function handleSerialConnect(event: SerialConnectionEvent): void {
  appendRawLog(`[serial] device available ${formatPortInfo(event.port.getInfo())}`);
}

function handleSerialDisconnect(event: SerialConnectionEvent): void {
  appendRawLog(`[serial] device disconnected ${formatPortInfo(event.port.getInfo())}`);

  if (event.port === port) {
    void releaseSerialConnection('lost');
  }
}

function formatPortInfo(info: SerialPortInfo): string {
  const vendorId = formatUsbId(info.usbVendorId);
  const productId = formatUsbId(info.usbProductId);

  if (vendorId && productId) {
    return `VID ${vendorId} / PID ${productId}`;
  }

  if (vendorId) {
    return `VID ${vendorId}`;
  }

  return 'unknown USB serial port';
}

function formatUsbId(value: number | undefined): string {
  return value === undefined ? '' : `0x${value.toString(16).padStart(4, '0')}`;
}

function serialErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('The device has been lost')) {
    return 'The TSIM 7600H-G serial device was lost. Reconnect the USB cable or reset the board, close other serial monitors, then connect again.';
  }

  return message;
}

function loadStoredAuth(): void {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { access?: string; refresh?: string; username?: string };
      if (parsed.access && parsed.refresh && parsed.username) {
        authToken.value = parsed.access;
        authRefreshToken.value = parsed.refresh;
        authUsername.value = parsed.username;
      }
    }
  } catch {
    // ignore malformed stored data
  }
}

function saveStoredAuth(access: string, refresh: string, username: string): void {
  authToken.value = access;
  authRefreshToken.value = refresh;
  authUsername.value = username;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access, refresh, username }));
}

function clearStoredAuth(): void {
  authToken.value = null;
  authRefreshToken.value = null;
  authUsername.value = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function logout(): void {
  clearStoredAuth();
}

function openAuthModal(view: 'login' | 'register' | 'forgot' = 'login'): void {
  authView.value = view;
  authFormUsername.value = '';
  authFormEmail.value = '';
  authFormPassword.value = '';
  authFormPasswordConfirm.value = '';
  authFormError.value = '';
  authFormSuccess.value = '';
  showAuthModal.value = true;
}

function closeAuthModal(): void {
  showAuthModal.value = false;
  authFormError.value = '';
  authFormSuccess.value = '';
}

function switchAuthView(view: 'login' | 'register' | 'forgot'): void {
  authView.value = view;
  authFormError.value = '';
  authFormSuccess.value = '';
}

async function submitAuthForm(): Promise<void> {
  authFormError.value = '';
  authFormSuccess.value = '';
  isAuthSubmitting.value = true;

  try {
    if (authView.value === 'login') {
      const data = await apiLogin(authFormUsername.value, authFormPassword.value);
      saveStoredAuth(data.access, data.refresh, data.username);
      closeAuthModal();
      if (pendingUploadAll) {
        pendingUploadAll = false;
        await doUploadAll();
      }
    } else if (authView.value === 'register') {
      const data = await apiRegister(
        authFormUsername.value,
        authFormEmail.value,
        authFormPassword.value,
        authFormPasswordConfirm.value,
      );
      saveStoredAuth(data.tokens.access, data.tokens.refresh, data.user.username);
      closeAuthModal();
      if (pendingUploadAll) {
        pendingUploadAll = false;
        await doUploadAll();
      }
    } else {
      await apiRequestReset(authFormEmail.value);
      authFormSuccess.value = 'Si el correo está registrado, recibirás instrucciones para restablecerla.';
    }
  } catch (error) {
    if (error instanceof ApiConfigError) {
      authFormError.value = error.message;
    } else {
      authFormError.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    isAuthSubmitting.value = false;
  }
}

async function tryRefreshToken(): Promise<boolean> {
  if (!authRefreshToken.value) return false;

  try {
    const data = await apiRefreshToken(authRefreshToken.value);
    authToken.value = data.access;
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ access: data.access, refresh: authRefreshToken.value, username: authUsername.value }),
    );
    return true;
  } catch {
    clearStoredAuth();
    return false;
  }
}

async function requestUploadAll(): Promise<void> {
  if (!isLoggedIn.value) {
    pendingUploadAll = true;
    openAuthModal('login');
    return;
  }
  await doUploadAll();
}

async function doUploadAll(): Promise<void> {
  isUploading.value = true;
  for (const type of (['ble', 'wifi', 'lte'] as ScanType[])) {
    const rows = type === 'lte' ? lteRows.value : type === 'wifi' ? wifiRows.value : bleRows.value;
    if (rows.length > 0) {
      await doUploadType(type);
    }
  }
  isUploading.value = false;
}

async function doUploadType(type: ScanType): Promise<void> {
  const rows = type === 'lte' ? lteRows.value : type === 'wifi' ? wifiRows.value : bleRows.value;
  if (rows.length === 0) return;

  uploadStatus.value[type] = 'uploading';
  uploadErrorMsg.value[type] = '';

  const csv = buildCsv(type, rows);
  const filename = makeCsvFilename(type);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

  try {
    let response = await apiUploadCsv(type, blob, filename, authToken.value!);

    if (response.status === 401) {
      const refreshed = await tryRefreshToken();
      if (!refreshed) {
        uploadStatus.value[type] = 'error';
        uploadErrorMsg.value[type] = 'Sesión expirada. Inicia sesión de nuevo.';
        return;
      }
      response = await apiUploadCsv(type, blob, filename, authToken.value!);
    }

    if (!response.ok) {
      const text = await response.text();
      uploadErrorMsg.value[type] = `Upload failed (${response.status}): ${text.slice(0, 200)}`;
      uploadStatus.value[type] = 'error';
      return;
    }

    uploadStatus.value[type] = 'ok';
    setTimeout(() => { uploadStatus.value[type] = 'idle'; }, 3000);
  } catch (error) {
    uploadErrorMsg.value[type] = error instanceof Error ? error.message : String(error);
    uploadStatus.value[type] = 'error';
  }
}

function clearRows(type: ScanType): void {
  if (type === 'lte') {
    lteRows.value = [];
  } else if (type === 'wifi') {
    wifiRows.value = [];
  } else {
    bleRows.value = [];
  }
}

function clearTerminal(): void {
  rawLogs.value = [];
  ignoredCount.value = 0;
}

function clearAll(): void {
  lteRows.value = [];
  wifiRows.value = [];
  bleRows.value = [];
  clearTerminal();
}

function downloadRows(type: 'lte'): void;
function downloadRows(type: 'wifi'): void;
function downloadRows(type: 'ble'): void;
function downloadRows(type: ScanType): void {
  const rows = type === 'lte' ? lteRows.value : type === 'wifi' ? wifiRows.value : bleRows.value;
  const csv = buildCsv(type, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = makeCsvFilename(type);
  anchor.click();
  URL.revokeObjectURL(url);
}

function loadSample(): void {
  const sample = [
    '[modem] AT sync OK',
    '[gps] GPS power enabled',
    'Source,Timestamp,Tecnología,Estado,MCC,MNC,LAC,CellID,Banda,RSSI,RSRP,RSRQ,SINR,Operador,Longitud,Latitud',
    'Source,Timestamp,Lat,Long,SSID,BSSID,Canal,Señal,Seguridad',
    'Source,Timestamp,Lat,Long,Dirección,RSSI,Nombre',
    '[ble] logged 1 devices'
  ];

  consumeEvents(sample.map((line) => parseSerialLine(line)));
}
</script>

<template>
  <main class="app-shell">
    <section class="topbar">
      <div>
        <p class="eyebrow">LilyGO TSIM 7600H-G 16 MB</p>
        <h1>Wardriving serial monitor</h1>
        <p class="intro">
          Read TSIM 7600H-G serial output, classify LTE, WiFi, and BLE rows, and export only records with usable coordinates.
        </p>
      </div>

      <div class="connection-panel">
        <label>
          Baud rate
          <select v-model.number="baudRate" :disabled="isConnected || isConnecting">
            <option v-for="rate in baudRates" :key="rate" :value="rate">{{ rate }}</option>
          </select>
        </label>

        <label>
          Serial control
          <select v-model="serialSignalMode" :disabled="isConnected || isConnecting">
            <option v-for="mode in serialSignalModes" :key="mode.value" :value="mode.value">{{ mode.label }}</option>
          </select>
        </label>

        <button v-if="!isConnected" type="button" :disabled="isConnecting || !isSerialSupported" @click="connectSerial">
          {{ isConnecting ? 'Connecting...' : 'Connect TSIM 7600H-G' }}
        </button>
        <button v-else type="button" class="secondary" @click="disconnectSerial">Disconnect</button>
        <button
          v-if="!isConnected"
          type="button"
          class="secondary"
          :disabled="isConnecting || !isSerialSupported"
          @click="connectFallbackSerial"
        >
          Other USB serial
        </button>
        <button
          v-if="!isConnected"
          type="button"
          class="secondary"
          :disabled="isConnecting || !isSerialSupported"
          @click="connectAnySerial"
        >
          Show all ports
        </button>
        <button type="button" class="secondary" :aria-pressed="colorMode === 'black'" @click="toggleColorMode">
          {{ colorModeLabel }}
        </button>
        <template v-if="isLoggedIn">
          <span class="auth-user">{{ authUsername }}</span>
          <button
            type="button"
            class="secondary"
            :disabled="!hasAnyRows || isUploading"
            @click="requestUploadAll"
          >{{ isUploading ? 'Uploading…' : 'Upload' }}</button>
          <button type="button" class="ghost" @click="logout">Log out</button>
        </template>
        <button v-else type="button" class="ghost" @click="openAuthModal('login')">Log in to upload</button>
      </div>
      <p v-if="uploadSummary" class="upload-summary">{{ uploadSummary }}</p>
    </section>

    <section v-if="!isSerialSupported" class="notice">
      Web Serial is available in Chromium browsers such as Chrome and Edge on HTTPS or localhost.
    </section>

    <section class="status-strip">
      <span :class="['status-dot', { online: isConnected }]"></span>
      <span>{{ statusMessage }}</span>
      <span v-if="selectedPortLabel">{{ selectedPortLabel }}</span>
      <span>{{ ignoredCount }} zero-coordinate rows ignored</span>
      <button type="button" class="ghost" @click="loadSample">Load sample</button>
      <button type="button" class="ghost" @click="clearTerminal">Clear terminal</button>
      <button
        type="button"
        class="ghost"
        :disabled="lteRows.length === 0 && wifiRows.length === 0 && bleRows.length === 0 && rawLogs.length === 0 && ignoredCount === 0"
        @click="clearAll"
      >Clear all</button>
    </section>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    <section class="terminal-section">
      <header>
        <div>
          <p class="eyebrow">Raw serial</p>
          <h2>{{ rawLogs.length }} lines</h2>
        </div>
      </header>
      <div ref="terminalRef" class="terminal" aria-live="polite">
        <p v-if="rawLogs.length === 0" class="empty">Connect a device or load the sample data.</p>
        <p v-for="line in rawLogs" :key="line.id">
          <span>{{ line.receivedAt }}</span>
          {{ line.text }}
        </p>
      </div>
    </section>
    <section class="tables-grid">
      <article class="scan-section">
        <header>
          <div>
            <p class="eyebrow">LTE</p>
            <h2>{{ lteRows.length }} records</h2>
          </div>
          <div class="section-actions">
            <button type="button" class="secondary" :disabled="lteRows.length === 0" @click="downloadRows('lte')">
              Download {{ lteFilename }}
            </button>
            <button type="button" class="ghost" :disabled="lteRows.length === 0" @click="clearRows('lte')">Clear</button>
          </div>
        </header>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lat</th>
                <th>Long</th>
                <th>Tech</th>
                <th>TipoCelda</th>
                <th>Operator</th>
                <th>eNodeB</th>
                <th>PCI</th>
                <th>Band</th>
                <th>EARFCN</th>
                <th>RSSI</th>
                <th>RSRP</th>
                <th>RSRQ</th>
                <th>SINR</th>
                <th>Captured</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in lteRows" :key="`${index}-${row.capturedAt}-${row.longitude}-${row.latitude}`">
                <td>{{ row.latitude }}</td>
                <td>{{ row.longitude }}</td>
                <td>{{ row.technology }}</td>
                <td>{{ row.cellType || '—' }}</td>
                <td>{{ row.operator || 'Unknown' }}</td>
                <td>{{ row.eNodeB || '—' }}</td>
                <td>{{ row.pci || '—' }}</td>
                <td>{{ row.band }}</td>
                <td>{{ row.earfcn || '—' }}</td>
                <td>{{ row.rssi }}</td>
                <td>{{ row.rsrp }}</td>
                <td>{{ row.rsrq }}</td>
                <td>{{ row.sinr }}</td>
                <td>{{ new Date(row.capturedAt).toLocaleTimeString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="scan-section">
        <header>
          <div>
            <p class="eyebrow">WiFi</p>
            <h2>{{ wifiRows.length }} access points</h2>
          </div>
          <div class="section-actions">
            <button type="button" class="secondary" :disabled="wifiRows.length === 0" @click="downloadRows('wifi')">
              Download {{ wifiFilename }}
            </button>
            <button type="button" class="ghost" :disabled="wifiRows.length === 0" @click="clearRows('wifi')">Clear</button>
          </div>
        </header>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lat</th>
                <th>Long</th>
                <th>SSID</th>
                <th>BSSID</th>
                <th>Channel</th>
                <th>Signal</th>
                <th>Security</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in wifiRows" :key="`${index}-${row.capturedAt}-${row.bssid}`">
                <td>{{ row.latitude }}</td>
                <td>{{ row.longitude }}</td>
                <td>{{ row.ssid || '(hidden)' }}</td>
                <td>{{ row.bssid }}</td>
                <td>{{ row.channel }}</td>
                <td>{{ row.signal }}</td>
                <td>{{ row.security }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="scan-section">
        <header>
          <div>
            <p class="eyebrow">BLE</p>
            <h2>{{ bleRows.length }} devices</h2>
          </div>
          <div class="section-actions">
            <button type="button" class="secondary" :disabled="bleRows.length === 0" @click="downloadRows('ble')">
              Download {{ bleFilename }}
            </button>
            <button type="button" class="ghost" :disabled="bleRows.length === 0" @click="clearRows('ble')">Clear</button>
          </div>
        </header>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lat</th>
                <th>Long</th>
                <th>Address</th>
                <th>RSSI</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in bleRows" :key="`${index}-${row.capturedAt}-${row.address}`">
                <td>{{ row.latitude }}</td>
                <td>{{ row.longitude }}</td>
                <td>{{ row.address }}</td>
                <td>{{ row.rssi }}</td>
                <td>{{ row.name || 'Unknown' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <div v-if="showAuthModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" @click.self="closeAuthModal">
      <div class="modal-card">
        <h2 id="auth-modal-title">
          {{ authView === 'login' ? 'Iniciar sesión' : authView === 'register' ? 'Crear cuenta' : 'Recuperar contraseña' }}
        </h2>

        <form @submit.prevent="submitAuthForm">
          <!-- Login y Register: username -->
          <label v-if="authView !== 'forgot'">
            {{ authView === 'login' ? 'Usuario o correo' : 'Nombre de usuario' }}
            <input
              v-model="authFormUsername"
              type="text"
              autocomplete="username"
              required
              :disabled="isAuthSubmitting"
              autofocus
            />
          </label>

          <!-- Register: email -->
          <label v-if="authView === 'register'">
            Correo electrónico
            <input v-model="authFormEmail" type="email" autocomplete="email" required :disabled="isAuthSubmitting" />
          </label>

          <!-- Forgot: email -->
          <label v-if="authView === 'forgot'">
            Correo electrónico
            <input v-model="authFormEmail" type="email" autocomplete="email" required :disabled="isAuthSubmitting" autofocus />
          </label>

          <!-- Login y Register: password -->
          <label v-if="authView !== 'forgot'">
            Contraseña
            <input
              v-model="authFormPassword"
              type="password"
              autocomplete="current-password"
              required
              :disabled="isAuthSubmitting"
            />
          </label>

          <!-- Register: confirmar password -->
          <label v-if="authView === 'register'">
            Confirmar contraseña
            <input v-model="authFormPasswordConfirm" type="password" autocomplete="new-password" required :disabled="isAuthSubmitting" />
          </label>

          <p v-if="authFormError" class="error">{{ authFormError }}</p>
          <p v-if="authFormSuccess" class="auth-success">{{ authFormSuccess }}</p>

          <div class="modal-actions">
            <button v-if="!authFormSuccess" type="submit" :disabled="isAuthSubmitting">
              {{ isAuthSubmitting
                ? '…'
                : authView === 'login'
                  ? 'Entrar'
                  : authView === 'register'
                    ? 'Registrarse'
                    : 'Enviar instrucciones' }}
            </button>
            <button type="button" class="ghost" @click="closeAuthModal">Cancelar</button>
          </div>
        </form>

        <div class="modal-links">
          <template v-if="authView === 'login'">
            <button type="button" class="link-btn" @click="switchAuthView('register')">Crear cuenta</button>
            <button type="button" class="link-btn" @click="switchAuthView('forgot')">¿Olvidaste tu contraseña?</button>
          </template>
          <template v-else>
            <button type="button" class="link-btn" @click="switchAuthView('login')">Volver al login</button>
          </template>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-card {
  background: var(--color-bg-section, #fff);
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  padding: 2rem;
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}

.modal-card h2 {
  margin: 0;
  font-size: 1.15rem;
}

.modal-card form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.modal-card label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.875rem;
}

.modal-card input {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  font-size: 1rem;
  background: var(--color-bg, #fff);
  color: var(--color-text, #000);
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.auth-user {
  font-size: 0.875rem;
  opacity: 0.75;
}

.upload-error {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
}

.upload-summary {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  padding: 0 1rem;
}

.auth-success {
  font-size: 0.875rem;
  color: var(--color-ok, green);
}

.modal-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.8rem;
  color: var(--color-link, #0070f3);
  cursor: pointer;
  text-decoration: underline;
}

.link-btn:hover {
  opacity: 0.75;
}
</style>
