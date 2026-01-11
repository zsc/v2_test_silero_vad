let audioContext;
let analyser;
let workletNode;
let source;
let socket;
let isRunning = false;
let seq = 0;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');

const thresholdInput = document.getElementById('threshold');
const thresholdVal = document.getElementById('thresholdVal');
const minSilenceInput = document.getElementById('minSilence');
const minSilenceVal = document.getElementById('minSilenceVal');
const speechPadInput = document.getElementById('speechPad');
const speechPadVal = document.getElementById('speechPadVal');
const modelSelect = document.getElementById('modelSelect');

const timeWindowSelect = document.getElementById('timeWindow');
const fftSizeSelect = document.getElementById('fftSize');

const spectrogramCanvas = document.getElementById('spectrogramCanvas');
const vadCanvas = document.getElementById('vadCanvas');
const ctxSpec = spectrogramCanvas.getContext('2d');
const ctxVad = vadCanvas.getContext('2d');

const statusEl = document.getElementById('status');
const seqEl = document.getElementById('seq');
const probEl = document.getElementById('prob');
const speechEl = document.getElementById('speechState');
const latencyEl = document.getElementById('latency');

let vadData = []; // Array of {prob, isSpeech, isConfirmed, time, fft}
let windowSizeSec = parseInt(timeWindowSelect.value);
const pendingResponses = new Map();

// Mel Spectrogram Constants
const NUM_MEL_BINS = 80;
let melFilterBank = [];

function initCanvases() {
    spectrogramCanvas.width = spectrogramCanvas.clientWidth;
    spectrogramCanvas.height = spectrogramCanvas.clientHeight;
    vadCanvas.width = vadCanvas.clientWidth;
    vadCanvas.height = vadCanvas.clientHeight;
    
    // Recalculate Mel filterbank when canvas or FFT settings might change
    if (analyser) {
        calculateMelFilterBank(analyser.frequencyBinCount, 16000);
    }
}

function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
}

function calculateMelFilterBank(fftSize, sampleRate) {
    melFilterBank = [];
    const minHz = 0;
    const maxHz = sampleRate / 2;
    const minMel = hzToMel(minHz);
    const maxMel = hzToMel(maxHz);
    
    const melStep = (maxMel - minMel) / NUM_MEL_BINS;
    const binWidth = sampleRate / (fftSize * 2); // fftSize here is actually frequencyBinCount (N/2)

    for (let i = 0; i < NUM_MEL_BINS; i++) {
        const startMel = minMel + i * melStep;
        const endMel = minMel + (i + 1) * melStep;
        
        const startHz = melToHz(startMel);
        const endHz = melToHz(endMel);
        
        const startBin = Math.floor(startHz / binWidth);
        const endBin = Math.ceil(endHz / binWidth);
        
        melFilterBank.push({ start: startBin, end: endBin });
    }
}

window.addEventListener('resize', initCanvases);
initCanvases();

function sendConfig() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'config', 
            model: modelSelect.value,
            threshold: parseFloat(thresholdInput.value),
            min_silence_ms: parseInt(minSilenceInput.value),
            speech_pad_ms: parseInt(speechPadInput.value)
        }));
    }
}

modelSelect.addEventListener('change', () => {
    sendConfig();
    vadData = [];
    initCanvases();
});

thresholdInput.addEventListener('input', () => {
    thresholdVal.textContent = parseFloat(thresholdInput.value).toFixed(2);
    sendConfig();
});

minSilenceInput.addEventListener('input', () => {
    minSilenceVal.textContent = minSilenceInput.value;
    sendConfig();
});

speechPadInput.addEventListener('input', () => {
    speechPadVal.textContent = speechPadInput.value;
    sendConfig();
});

timeWindowSelect.addEventListener('change', () => {
    windowSizeSec = parseInt(timeWindowSelect.value);
    vadData = []; 
});

fftSizeSelect.addEventListener('change', () => {
    if (analyser) {
        analyser.fftSize = parseInt(fftSizeSelect.value);
        calculateMelFilterBank(analyser.frequencyBinCount, 16000);
    }
});

startBtn.onclick = start;
stopBtn.onclick = stop;
resetBtn.onclick = () => {
    vadData = [];
    seq = 0;
    initCanvases();
};

async function start() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000,
        });
        
        await audioContext.audioWorklet.addModule('/static/audio-processor.js');
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        source = audioContext.createMediaStreamSource(stream);
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = parseInt(fftSizeSelect.value);
        analyser.smoothingTimeConstant = 0; // Don't double smooth, we want raw frames
        
        calculateMelFilterBank(analyser.frequencyBinCount, 16000);

        workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        
        source.connect(analyser);
        analyser.connect(workletNode);
        
        setupWebSocket();
        
        workletNode.port.onmessage = (event) => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                sendAudio(event.data);
            }
        };
        
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusEl.textContent = 'Connecting...';
        
        requestAnimationFrame(draw);
    } catch (err) {
        console.error(err);
        alert('Could not access microphone: ' + err.message);
    }
}

function stop() {
    isRunning = false;
    if (source) source.disconnect();
    if (analyser) analyser.disconnect();
    if (workletNode) workletNode.disconnect();
    if (audioContext) audioContext.close();
    if (socket) socket.close();
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = 'Stopped';
    statusEl.classList.remove('connected');
}

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.binaryType = 'arraybuffer';
    
    socket.onopen = () => {
        statusEl.textContent = 'Connected';
        statusEl.classList.add('connected');
        sendConfig(); // Send initial config
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'vad_result') {
            handleVadResult(data);
        }
    };
    
    socket.onclose = () => {
        if (isRunning) {
            statusEl.textContent = 'Disconnected (Retrying...)';
            statusEl.classList.remove('connected');
            setTimeout(setupWebSocket, 2000);
        }
    };
}

function sendAudio(float32Data) {
    const pcm16 = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
        pcm16[i] = Math.max(-32768, Math.min(32767, float32Data[i] * 32768));
    }
    
    const buffer = new ArrayBuffer(16 + pcm16.byteLength);
    const view = new DataView(buffer);
    
    view.setUint8(0, 86); // V
    view.setUint8(1, 65); // A
    view.setUint8(2, 68); // D
    view.setUint8(3, 49); // 1
    
    view.setUint32(4, seq, true);
    view.setUint32(8, 16000, true);
    view.setUint16(12, 1, true);
    view.setUint16(14, pcm16.length, true);
    
    const pcmUint8 = new Uint8Array(buffer, 16);
    pcmUint8.set(new Uint8Array(pcm16.buffer));
    
    socket.send(buffer);
    pendingResponses.set(seq, performance.now());
    seq++;
}

function handleVadResult(data) {
    const now = performance.now();
    const sentTime = pendingResponses.get(data.seq);
    if (sentTime) {
        const latency = now - sentTime;
        latencyEl.textContent = Math.round(latency);
        pendingResponses.delete(data.seq);
    }
    
    seqEl.textContent = data.seq;
    probEl.textContent = data.speech_prob.toFixed(3);
    speechEl.textContent = data.is_speech ? 'ON' : 'OFF';
    speechEl.style.color = data.is_speech ? '#00e676' : '#ff5252';
    
    const bufferLength = analyser.frequencyBinCount;
    const fftData = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(fftData);

    vadData.push({
        prob: data.speech_prob,
        isSpeech: data.is_speech,
        isConfirmed: data.is_confirmed,
        time: now,
        fft: fftData
    });
    
    const cutoff = now - windowSizeSec * 1000;
    while (vadData.length > 0 && vadData[0].time < cutoff) {
        vadData.shift();
    }
}

function draw() {
    if (!isRunning) return;
    
    const width = spectrogramCanvas.width;
    const height = spectrogramCanvas.height;
    const now = performance.now();
    const cutoff = now - windowSizeSec * 1000;

    // Draw Spectrogram
    ctxSpec.clearRect(0, 0, width, height);
    if (vadData.length > 1 && melFilterBank.length > 0) {
        for (let i = 0; i < vadData.length; i++) {
            const item = vadData[i];
            const x = ((item.time - cutoff) / (windowSizeSec * 1000)) * width;
            const nextX = (i < vadData.length - 1) ? 
                ((vadData[i+1].time - cutoff) / (windowSizeSec * 1000)) * width : width;
            
            const fft = item.fft;
            const sliceHeight = height / NUM_MEL_BINS;
            
            // Render Mel Bins
            for (let j = 0; j < NUM_MEL_BINS; j++) {
                const range = melFilterBank[j];
                // Aggregate energy in this Mel bin (using Max or Avg)
                let maxVal = 0;
                // Safety check
                const start = Math.min(range.start, fft.length - 1);
                const end = Math.min(range.end, fft.length);
                
                for (let k = start; k < end; k++) {
                    if (fft[k] > maxVal) maxVal = fft[k];
                }
                
                if (maxVal > 0) {
                    const hue = (1 - maxVal / 255) * 240;
                    ctxSpec.fillStyle = `hsl(${hue}, 100%, ${maxVal / 255 * 50}%)`;
                    // Draw from bottom up (low freq at bottom)
                    // j=0 is lowest freq (bottom)
                    ctxSpec.fillRect(x, height - (j + 1) * sliceHeight, nextX - x + 1, sliceHeight + 1);
                }
            }
        }
    }

    drawVad();
    requestAnimationFrame(draw);
}

function drawVad() {
    const width = vadCanvas.width;
    const height = vadCanvas.height;
    const now = performance.now();
    const cutoff = now - windowSizeSec * 1000;
    
    ctxVad.clearRect(0, 0, width, height);
    
    const thresholdY = height * (1 - parseFloat(thresholdInput.value));
    
    // Draw grid/threshold line
    ctxVad.strokeStyle = '#555';
    ctxVad.setLineDash([5, 5]);
    ctxVad.beginPath();
    ctxVad.moveTo(0, thresholdY);
    ctxVad.lineTo(width, thresholdY);
    ctxVad.stroke();
    ctxVad.setLineDash([]);
    
    if (vadData.length < 2) return;
    
    // Draw "Fast" Speech (Green) - Bottom layer
    ctxVad.fillStyle = 'rgba(0, 230, 118, 0.3)';
    for (let i = 0; i < vadData.length - 1; i++) {
        if (vadData[i].isSpeech) {
            const x1 = ((vadData[i].time - cutoff) / (windowSizeSec * 1000)) * width;
            const x2 = ((vadData[i+1].time - cutoff) / (windowSizeSec * 1000)) * width;
            // Draw a bit higher to distinguish
            ctxVad.fillRect(x1, height - 30, x2 - x1, 15);
        }
    }

    // Draw "Stable" Speech (Blue) - Top layer
    ctxVad.fillStyle = 'rgba(64, 196, 255, 0.5)';
    for (let i = 0; i < vadData.length - 1; i++) {
        if (vadData[i].isConfirmed) {
            const x1 = ((vadData[i].time - cutoff) / (windowSizeSec * 1000)) * width;
            const x2 = ((vadData[i+1].time - cutoff) / (windowSizeSec * 1000)) * width;
            // Draw at bottom
            ctxVad.fillRect(x1, height - 15, x2 - x1, 15);
        }
    }
    
    // Draw probability curve
    ctxVad.strokeStyle = '#00e676';
    ctxVad.lineWidth = 2;
    ctxVad.beginPath();
    
    for (let i = 0; i < vadData.length; i++) {
        const x = ((vadData[i].time - cutoff) / (windowSizeSec * 1000)) * width;
        const y = height * (1 - vadData[i].prob);
        if (i === 0) ctxVad.moveTo(x, y);
        else ctxVad.lineTo(x, y);
    }
    ctxVad.stroke();
}
