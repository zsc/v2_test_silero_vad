import json
import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from silero_vad import load_silero_vad, VADIterator

app = FastAPI()

# Load Silero VAD model
model = load_silero_vad()
torch.set_num_threads(1)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get():
    return FileResponse("static/index.html")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Initialize VAD iterator for this session
    # threshold=0.5 is default
    vad_iterator = VADIterator(model)
    
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
                # we assume sample_rate=16000, channels=1, samples=512 for now as per spec
                pcm_data = data[16:]
                
                # Convert bytes to float32 tensor for Silero VAD
                audio_int16 = np.frombuffer(pcm_data, dtype=np.int16)
                audio_float32 = audio_int16.astype(np.float32) / 32768.0
                input_tensor = torch.from_numpy(audio_float32)
                
                # Get speech probability
                speech_prob = model(input_tensor, 16000).item()
                
                # Use VADIterator for events
                vad_out = vad_iterator(input_tensor, return_seconds=True)
                
                response = {
                    "type": "vad_result",
                    "seq": seq,
                    "speech_prob": speech_prob,
                    "is_speech": speech_prob > vad_iterator.threshold, # Raw instant decision
                    "is_confirmed": vad_iterator.triggered, # Smoothed/Stable decision
                    "event": vad_out if vad_out else None
                }
                await websocket.send_json(response)
                
            elif "text" in message:
                data = json.loads(message["text"])
                if data.get("type") == "config":
                    # Update threshold or other params if needed
                    if "threshold" in data:
                        vad_iterator.threshold = data["threshold"]
                    if "min_silence_ms" in data:
                        vad_iterator.min_silence_samples = data["min_silence_ms"] * 16 # 16 samples per ms at 16k
                    if "speech_pad_ms" in data:
                        vad_iterator.speech_pad_samples = data["speech_pad_ms"] * 16
                    
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        # Reset VAD iterator state
        vad_iterator.reset_states()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
