import json
import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from silero_vad import load_silero_vad, VADIterator
from funasr import AutoModel

app = FastAPI()

# Load Silero VAD model
print("Loading Silero VAD...")
silero_model = load_silero_vad()
torch.set_num_threads(1)

# Load FSMN VAD model
print("Loading FSMN VAD...")
# disable_update=True to avoid checking for updates every time
fsmn_model = AutoModel(model="fsmn-vad", model_revision="v2.0.4", disable_update=True)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

class SileroWrapper:
    def __init__(self, model):
        self.iterator = VADIterator(model)
        self.model = model
        
    def reset(self):
        self.iterator.reset_states()
        
    def process(self, audio_tensor, audio_numpy):
        # audio_tensor for model/iterator
        prob = self.model(audio_tensor, 16000).item()
        vad_out = self.iterator(audio_tensor, return_seconds=True)
        return {
            "prob": prob,
            "is_speech": prob > self.iterator.threshold,
            "is_confirmed": self.iterator.triggered,
            "event": vad_out if vad_out else None
        }

    def update_config(self, data):
        if "threshold" in data:
            self.iterator.threshold = data["threshold"]
        if "min_silence_ms" in data:
            self.iterator.min_silence_samples = data["min_silence_ms"] * 16
        if "speech_pad_ms" in data:
            self.iterator.speech_pad_samples = data["speech_pad_ms"] * 16

class FSMNWrapper:
    def __init__(self, model):
        self.model = model
        self.cache = {}
        self.buffer = np.array([], dtype=np.float32)
        self.chunk_size_ms = 200
        self.chunk_samples = int(16000 * self.chunk_size_ms / 1000) # 3200
        self.in_speech = False
        
    def reset(self):
        self.cache = {}
        self.buffer = np.array([], dtype=np.float32)
        self.in_speech = False

    def process(self, audio_tensor, audio_numpy):
        # audio_numpy is float32
        self.buffer = np.concatenate((self.buffer, audio_numpy))
        
        event = None
        
        # Process as many 200ms chunks as possible
        while len(self.buffer) >= self.chunk_samples:
            chunk = self.buffer[:self.chunk_samples]
            self.buffer = self.buffer[self.chunk_samples:]
            
            # Run FSMN VAD
            res = self.model.generate(input=chunk, cache=self.cache, is_final=False, chunk_size=self.chunk_size_ms)
            
            if res and len(res) > 0:
                value = res[0].get("value")
                if value:
                    for segment in value:
                        start, end = segment
                        if start != -1 and end == -1:
                            self.in_speech = True
                        elif start == -1 and end != -1:
                            self.in_speech = False
        
        # Return current state
        # Simulate probability: 1.0 if speech, 0.0 if not
        prob = 1.0 if self.in_speech else 0.0
        return {
            "prob": prob,
            "is_speech": self.in_speech,
            "is_confirmed": self.in_speech, # FSMN is usually quite stable/confirmed by nature
            "event": event
        }

    def update_config(self, data):
        pass

@app.get("/")
async def get():
    return FileResponse("static/index.html")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    silero_wrapper = SileroWrapper(silero_model)
    fsmn_wrapper = FSMNWrapper(fsmn_model)
    
    try:
        while True:
            # Receive message from client
            message = await websocket.receive()
            
            if "bytes" in message:
                # Binary format: [magic(4), seq(4), sample_rate(4), channels(2), samples(2), pcm(N)]
                data = message["bytes"]
                if len(data) < 16:
                    continue
                
                magic = data[0:4]
                if magic != b'VAD1':
                    continue
                
                seq = int.from_bytes(data[4:8], "little")
                pcm_data = data[16:]
                
                # Convert bytes to float32
                audio_int16 = np.frombuffer(pcm_data, dtype=np.int16)
                audio_float32 = audio_int16.astype(np.float32) / 32768.0
                
                # Silero expects tensor
                input_tensor = torch.from_numpy(audio_float32)
                
                # Process Both
                silero_res = silero_wrapper.process(input_tensor, audio_float32)
                fsmn_res = fsmn_wrapper.process(input_tensor, audio_float32)
                
                response = {
                    "type": "vad_result",
                    "seq": seq,
                    "silero": silero_res,
                    "fsmn": fsmn_res
                }
                await websocket.send_json(response)
                
            elif "text" in message:
                data = json.loads(message["text"])
                if data.get("type") == "config":
                    # Pass config to wrappers
                    silero_wrapper.update_config(data)
                    fsmn_wrapper.update_config(data)
                    
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        silero_wrapper.reset()
        fsmn_wrapper.reset()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
