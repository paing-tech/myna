// Runs on the audio thread, not the main thread.
// Input: Float32 samples in blocks of 128. Output: 100 ms Int16 chunks.
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(1600); // 100 ms at 16 kHz
    this.offset = 0;
  }

  process(inputs) {
    const samples = inputs[0][0]; // first input, first (mono) channel
    if (!samples) return true;

    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i])); // clamp
      this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.offset === this.buffer.length) {
        // Transfer (not copy) the bytes to the main thread
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(1600);
        this.offset = 0;
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor("pcm-processor", PcmProcessor);
