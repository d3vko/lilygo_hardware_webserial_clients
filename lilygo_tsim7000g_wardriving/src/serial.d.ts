interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface SerialConnectionEvent extends Event {
  port: SerialPort;
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
  addEventListener(type: 'connect' | 'disconnect', listener: (event: SerialConnectionEvent) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: SerialConnectionEvent) => void): void;
}

interface Navigator {
  serial?: Serial;
}
