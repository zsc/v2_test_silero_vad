# Real-time Mic Spectrum + Multi-model VAD Visualization (Silero & FSMN)

这是一个端到端的 Python + HTML 演示项目，用于实时采集麦克风音频，并对照展示 **Silero VAD** 和 **FSMN VAD** 的检测结果与音频的 **Mel 频谱（滚动声谱图）**。

## 1. 背景与目标

本项目基于 [CLAUDE.md](CLAUDE.md) 规格说明书开发，旨在提供一个快速验证和对比不同 VAD（Voice Activity Detection，语音活动检测）算法效果的可视化工具。

主要目标包括：
*   **实时采集**：使用浏览器 Web Audio API 获取麦克风流。
*   **多算法对照**：同步显示 **Silero VAD** 和 **FSMN VAD** 的检测结果。
*   **可视化对照**：展示**滚动 Mel 声谱图（Mel Spectrogram）**，便于直观观察语音与 VAD 信号的对应关系。
*   **低延迟**：通过 AudioWorklet 和 WebSocket 实现低延迟通信。
*   **交互式调参**：支持在网页端实时调整 VAD 阈值等参数（主要针对 Silero）。

## 2. 核心算法与技术架构

### 2.1 算法一：Silero VAD
本项目使用 [**Silero VAD**](https://github.com/snakers4/silero-vad) 作为核心检测算法之一。
*   **特点**：基于深度神经网络（DNN），对噪声具有极强的鲁棒性，模型极小且推理极快。
*   **双重判决策略**：
    1.  **Fast Trigger (快速起声)**：基于原始概率，响应极快（10-30ms）。
    2.  **Stable Confirmation (稳定确认)**：利用 `VADIterator` 维护的状态，包含平滑和静音保护逻辑。

### 2.2 算法二：FSMN VAD (FunASR)
本项目集成了阿里巴巴 [**FunASR**](https://github.com/alibaba-damo-academy/FunASR) 中的 **FSMN-VAD**。
*   **特点**：采用前馈顺序记忆网络（Feedforward Sequential Memory Network），在保持低延迟的同时具有很高的准确率，常用于工业级语音识别系统的预处理。
*   **推理模式**：流式处理，通常以 200ms 的 Chunk 进行判定，结果非常稳定。

### 2.3 技术架构
采用 **Browser + WebSocket + Python Backend** 架构：

1.  **前端 (HTML/JS)**：
    *   使用 `AudioWorklet` 进行音频采集（16kHz/Mono）。
    *   实时绘制 **80 Mel bins** 的瀑布图。
    *   通过 WebSocket 发送二进制音频流，并异步接收两路 VAD 处理结果。

2.  **后端 (Python/FastAPI)**：
    *   并发运行 Silero 和 FSMN 两套推理引擎。
    *   集成 `PyTorch` 和 `FunASR` 框架。
    *   实时反馈 Speech Probability 和判定状态。

## 3. 快速开始

### 3.1 环境要求
*   Python 3.8+
*   支持 PyTorch 运行的环境

### 3.2 安装依赖
```bash
pip install silero-vad fastapi uvicorn numpy torch funasr modelscope
```

### 3.3 运行
启动后端服务：
```bash
python main.py
```
服务默认运行在 `http://localhost:8000`。

### 3.4 界面说明
1.  **Spectrogram**：滚动 Mel 声谱图，低频在下，颜色亮度代表能量。
2.  **VAD 可视化区**（分为上下两部分）：
    *   **上半部分 (Silero)**：
        *   **绿色曲线**：原始语音概率 (0.0~1.0)。
        *   **浅绿色背景**：快速触发 (Fast Trigger) 状态。
        *   **淡蓝色背景**：稳定确认 (Stable/Confirmed) 状态。
    *   **下半部分 (FSMN)**：
        *   **橙色色块**：FSMN 检测到的语音段，通常具有更好的连续性和稳定性。
3.  **Status Panel**：显示两路 VAD 的即时数值及端到端延迟 (Latency)。

## 4. 参考文档
详细的设计规格说明请参考 [CLAUDE.md](CLAUDE.md)。
