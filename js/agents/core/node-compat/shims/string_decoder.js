/**
 * string_decoder shim - Minimal StringDecoder implementation
 * Uses browser's TextDecoder for decoding buffers
 */

export class StringDecoder {
  constructor(encoding = 'utf8') {
    this.encoding = encoding;
    this.decoder = new TextDecoder(encoding);
  }

  write(buffer) {
    if (!buffer || buffer.length === 0) return '';
    return this.decoder.decode(buffer, { stream: true });
  }

  end(buffer) {
    if (!buffer || buffer.length === 0) return '';
    return this.decoder.decode(buffer);
  }
}

export default { StringDecoder };
