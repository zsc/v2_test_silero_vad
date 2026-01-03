class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 512;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.offset++] = channelData[i];
        
        if (this.offset >= this.chunkSize) {
          // Send the full chunk to the main thread
          this.port.postMessage(this.buffer);
          // Create new buffer to avoid modification issues
          this.buffer = new Float32Array(this.chunkSize);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
