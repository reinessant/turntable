/* BC-8 bitcrusher: sample-and-hold (rate ÷ n) + quantisation to n bits. Runs on the audio thread. */
class Bitcrusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bits", defaultValue: 8, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "rate", defaultValue: 4, minValue: 1, maxValue: 64, automationRate: "k-rate" }
    ];
  }
  constructor() { super(); this.held = [0, 0]; this.phase = 0; }
  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0];
    const bits = parameters.bits[0], step = Math.max(1, parameters.rate[0]);
    const levels = Math.pow(2, bits - 1);
    const frames = output[0].length;
    for (let i = 0; i < frames; i++) {
      this.phase += 1;
      const sample = this.phase >= step;
      if (sample) this.phase -= step;
      for (let c = 0; c < output.length; c++) {
        const source = input[c] || input[0];
        if (!source) { output[c][i] = 0; continue; }
        if (sample) this.held[c] = Math.round(source[i] * levels) / levels;
        output[c][i] = this.held[c] || 0;
      }
    }
    return true;
  }
}
registerProcessor("bitcrusher", Bitcrusher);
