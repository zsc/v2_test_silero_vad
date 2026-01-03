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
    *   使用 `AudioWorklet` 进行音频采集，固定采样率为 16kHz。
    *   实时绘制 **Mel 瀑布图**（Mel Spectrogram），默认使用 **80 Mel bins**。
    *   通过 WebSocket 发送自定义**二进制协议**帧（包含 Magic Header、Seq、PCM 数据）。
    *   支持动态调整 FFT 大小（1024-4096）和显示窗口长度（1s-10s）。

2.  **后端 (Python/FastAPI)**：
    *   基于 `FastAPI` 提供 WebSocket 服务。
    *   集成 `PyTorch` 和 `silero-vad` 模型进行高性能推理（默认开启单线程优化）。
    *   通过 `VADIterator` 维护状态，实时反馈 Speech Probability、Fast Trigger 和 Stable/Confirmed 状态。
    *   支持通过 WebSocket 实时更新模型配置（Threshold, Min Silence, Speech Pad）。

## 3. 快速开始

### 3.1 环境要求
*   Python 3.8+
*   操作系统支持声音设备访问（建议 Chrome/Edge 浏览器）

### 3.2 安装依赖
```bash
pip install silero-vad fastapi uvicorn numpy torch
```

### 3.3 运行
启动后端服务：
```bash
python3 main.py
```
服务默认运行在 `http://localhost:8000`。

### 3.4 使用说明
1.  打开浏览器访问 `http://localhost:8000`。
2.  点击 **Start** 按钮并授权麦克风权限。
3.  **界面说明**：
    *   **Spectrogram**：滚动 Mel 声谱图，低频在下，颜色亮度代表能量。
    *   **VAD (Probability & Speech)**：
        *   **绿色曲线**：原始语音概率 (0.0~1.0)。
        *   **浅绿色背景**：快速触发状态 (Fast Trigger)，基于原始概率即时判定。
        *   **淡蓝色背景**：稳定确认状态 (Stable/Confirmed)，基于平滑算法和静音保护。
    *   **Status Panel**：实时显示当前序列号 (Seq)、概率 (Prob)、语音开关状态和**端到端延迟 (Latency)**。
4.  **实时调参**：
    *   **Threshold**：判定阈值（默认 0.5）。
    *   **Min Silence (ms)**：判定为静音所需的连续静音时长（默认 100ms）。
    *   **Speech Pad (ms)**：检测到语音后向前/向后填充的缓冲时间（默认 30ms）。
    *   **Window (s)**：画布显示的滚动时长。
    *   **FFT Size**：影响声谱图的频率分辨率。

## 4. 参考文档
详细的设计规格说明请参考 [CLAUDE.md](CLAUDE.md)。
