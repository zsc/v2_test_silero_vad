# Real-time Mic Spectrum + Silero VAD Visualization

这是一个端到端的 Python + HTML 演示项目，用于实时采集麦克风音频，并对照展示 **Silero VAD** 的检测结果与音频的 **Mel 频谱（滚动声谱图）**。

## 1. 背景与目标

本项目基于 [CLAUDE.md](CLAUDE.md) 规格说明书开发，旨在提供一个快速验证 VAD（Voice Activity Detection，语音活动检测）效果的可视化工具。

主要目标包括：
*   **实时采集**：使用浏览器 Web Audio API 获取麦克风流。
*   **可视化对照**：同步显示**滚动 Mel 声谱图（Mel Spectrogram）**和 VAD 概率曲线/状态，便于直观观察语音与 VAD 信号的对应关系。
*   **低延迟**：通过 AudioWorklet 和 WebSocket 实现低延迟通信（目标 < 300ms）。
*   **交互式调参**：支持在网页端实时调整 VAD 阈值、静音保护（Hangover）等参数。

## 2. 核心算法与技术架构

### 2.1 算法：Silero VAD
本项目使用 [**Silero VAD**](https://github.com/snakers4/silero-vad) 作为核心检测算法。
*   **模型**：基于深度神经网络（DNN），对噪声具有较强的鲁棒性。
*   **推理模式**：流式推理（Streaming Inference），按 Chunk（512 samples @ 16kHz, ~32ms）处理。
*   **双重判决策略**：
    1.  **Fast Trigger (快速起声)**：基于原始概率（Probability > Threshold），响应极快（10-30ms），但可能存在毛刺。
    2.  **Stable Confirmation (稳定确认)**：利用 `VADIterator` 维护的状态，包含平滑（Smoothing）和静音保护（Hangover）逻辑，更加稳定。

### 2.2 技术架构
采用 **Browser + WebSocket + Python Backend** 架构：

1.  **前端 (HTML/JS)**：
    *   使用 `AudioWorklet` 进行音频采集与 16kHz 重采样（int16 PCM）。
    *   使用 Canvas 绘制实时 **Mel 瀑布图**（Mel Spectrogram，80 Mel bins）。
    *   通过 WebSocket 发送二进制音频帧。

2.  **后端 (Python/FastAPI)**：
    *   基于 `FastAPI` 提供 WebSocket 服务。
    *   集成 `PyTorch` 和 `silero-vad` 进行实时推理。
    *   支持动态配置更新（阈值、平滑窗口等）。

## 3. 快速开始

### 3.1 环境要求
*   Python 3.8+
*   Node.js (可选，仅用于开发时的静态检查)

### 3.2 安装依赖
```bash
pip install silero-vad fastapi uvicorn numpy torch aiofiles
```
*(注意：`silero-vad` 可能会自动安装 `onnxruntime` 和 `torch`)*

### 3.3 运行
启动后端服务：
```bash
python3 main.py
```
服务启动后，终端会显示访问地址（通常为 `http://0.0.0.0:8000`）。

### 3.4 使用说明
1.  打开浏览器访问 `http://localhost:8000`。
2.  点击 **Start** 按钮，授予麦克风权限。
3.  **观察可视化**：
    *   上方为滚动 **Mel 声谱图**（低频在下，高频在上，颜色亮度表示能量）。
    *   下方为 VAD 状态图：
        *   **绿色曲线**：语音概率 (Probability)。
        *   **绿色色块**：快速触发状态 (Fast Trigger)。
        *   **蓝色色块**：稳定确认状态 (Stable Confirmed)。
4.  **调整参数**：
    *   **Threshold**：判定阈值。
    *   **Min Silence (ms)**：静音保护时间（Hangover），即停止说话后多久才判定为静音（建议 200-400ms 以保留尾音）。
    *   **Speech Pad (ms)**：语音段前后的填充缓冲。

## 4. 参考文档
详细的设计规格说明请参考 [CLAUDE.md](CLAUDE.md)。
