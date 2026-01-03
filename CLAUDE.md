# 软件规格说明书（Spec）

## 项目名

**Real-time Mic Spectrum + Silero VAD 对照可视化 Demo（Python + HTML）**

> **Silero VAD / silero-vad（snakers4/silero-vad）**。本文 spec 以 Silero VAD 为准。([GitHub][1])

---

## 1. 背景与目标

### 1.1 背景

需要一个可运行的 Python + HTML 端到端 demo，实现：

* 使用麦克风实时采集音频；
* 实时显示麦克风的**mel 频谱（建议用滚动声谱图/瀑布图）**；
* 同步显示 **Silero VAD** 的分析结果（至少包含每帧 speech probability，并可选显示 speech start/end 段落）；
* 频谱与 VAD 信号均采用**滚动刷新（rolling/scrolling）**方式展示（时间轴不断向前推进）。

Silero VAD 支持 8 kHz / 16 kHz 采样率，典型推理方式是按固定 chunk 输出每段音频的 speech probability。官方示例中常用 **16kHz 下 chunk=512 samples（约 32ms）** 做流式/伪流式推理。([GitHub][1])

### 1.2 目标Goals）

1. **实时采集**：浏览器端获取麦克风权限后持续采集音频流。
2. **实时频谱滚动可视化**：HTML 页面中显示随时间滚动的频谱。可配置项在网页上可配置。
3. **实时 VAD 结果可视化**：显示每个音频 chunk 的：

   * speech probability（0~1）
   * 以及基于阈值的 speech/non-speech（二值信号）
   * 可选：VADIterator 输出的段落事件（speech start/end）。
4. **对照显示**：频谱与 VAD 时间轴对齐，同一条时间线上对照。
5. **低延迟**：从采集到页面显示 VAD 结果的端到端延迟尽量控制在可感知很低的范围（例如 < 300ms 的量级，具体见 NFR）。

### 1.3 非目标（Non-goals）

* 不做语音识别（ASR）。
* 不做多说话人/分离。
* 不做生产级鉴权、横向扩展、分布式部署。
* 不要求在移动端浏览器完美适配（可作为后续扩展）。

---

## 2. 使用场景与用户故事

### 2.1 目标用户

* 需要快速验证 VAD 效果的开发者
* 做语音交互/录音切分/端点检测的工程人员
* 演示用（demo/poc）

### 2.2 用户故事（User Stories）

* US-1：作为开发者，我打开网页授权麦克风后，能看到**滚动声谱图**实时更新。
* US-2：我说话时，VAD probability 明显升高并触发 speech 状态；我停下时概率下降并回到非 speech。
* US-3：我调整阈值/平滑参数后，能即时看到 VAD 变化（更敏感/更保守）。
* US-4：我点击 Stop 后，采集停止、服务端 session 清理、页面停止滚动。

---

## 3. 总体方案与架构

### 3.1 架构概览

采用 **Browser 采集 + WebSocket 推流到 Python 后端做 VAD + WebSocket 回传结果 + Browser 绘图** 的结构：

**前端（HTML/JS）**

* getUserMedia 获取麦克风流
* Web Audio API：

  * 用 AnalyserNode（或自算 FFT）生成频谱数据用于声谱图绘制
  * 用 AudioWorklet（推荐）或 ScriptProcessor（不推荐）取到 PCM 帧
* WebSocket：

  * 上行：发送音频 chunk（建议 16kHz/mono/int16）
  * 下行：接收 VAD 结果（probability、binary、可选事件）

**后端（Python）**

* FastAPI/Flask 提供静态页面与 WebSocket endpoint
* 加载 Silero VAD 模型（torch.hub 或 pip `silero-vad`）
* 按 chunk 推理输出 probability
* 可选使用 `VADIterator` 产生 speech start/end 事件
* 回传结果到前端绘制

Silero VAD 官方提供 pip 用法与 torch.hub 用法，并在示例中强调 16kHz 下常用 512-sample chunk（32ms）进行流式迭代或直接输出概率。([GitHub][1])

---

## 4. 详细功能需求（Functional Requirements）

### FR-1：前端麦克风采集

* 页面加载后用户点击 “Start”：

  1. 请求麦克风权限
  2. 创建 AudioContext
  3. 建立音频处理链路（MediaStreamSource → 分支到 analyser + worklet）
* 支持选择输入设备（可选项：通过 enumerateDevices）。

**验收点**

* 未授权麦克风时明确提示并不可启动。
* 授权成功后开始产生持续音频 chunk 与频谱数据。

---

### FR-2：采样率与音频格式统一

Silero VAD 常用采样率为 16k 或 8k。([GitHub][1])
本 demo 统一采用：

* **单声道 mono**
* **16 kHz**
* **int16 PCM little-endian**
* chunk = **512 samples**（约 32ms），与官方示例一致（16k→512；8k→256）。([GitHub][2])

**实现约束（对 spec 的要求）**

* 若浏览器 AudioContext 实际 sampleRate 非 16k（常见 48k），前端必须进行**降采样**到 16k（线性插值/简单抽取+低通均可，demo 可简单实现，但需在文档中注明质量影响）。
* 每个 chunk 附带 seq/timestamp，用于对齐绘图。

**验收点**

* 后端收到的每个 chunk 都满足 16k/mono/int16/512 samples。
* 对齐字段 seq 单调递增且无重复。

---

### FR-3：后端 Silero VAD 推理（概率输出）

* 后端启动时加载 Silero VAD：

  * 推荐：`pip install silero-vad` 并 `load_silero_vad()`
  * 或：`torch.hub.load('snakers4/silero-vad', 'silero_vad')`([GitHub][1])
* 推理模式：

  * 对每个 chunk 输出 `speech_prob ∈ [0,1]`
  * 维护模型 state（持续流式时不重置；Stop 或 session 结束时 reset states）
* 线程设置：

  * 可设置 `torch.set_num_threads(1)`（官方示例常这么做，且模型以 CPU 单线程优化为重点）。([PyTorch][3])

**验收点**

* 后端每收到一个 chunk，都会返回对应 seq 的 speech_prob（允许少量丢帧但应统计并提示）。
* speech_prob 随说话/静音有明显区分。

---

### FR-4：VAD 二值化与事件输出（可视化友好）

前端需要两类信号：

1. **连续值**：speech_prob
2. **二值值**：is_speech（阈值判定 + 可选滞回/平滑）

可选增强（推荐）：

* 使用 `VADIterator` 产生事件：speech start / end（返回 dict）。官方 wiki 给出了 `VADIterator` 的“stream imitation example”。([GitHub][2])

**参数（可在 UI 调整）**

* threshold（默认 0.5）
* min_silence_duration_ms（默认 500ms，若用 VADIterator）
* speech_pad_ms（默认 100ms，若用 VADIterator）
* smoothing（例如对 probability 做滑动平均，demo 可选）

**验收点**

* 页面能显示 probability 曲线 + 阈值线 + 二值条带（speech/非speech）。
* 若启用事件：能在时间轴上标出 start/end。

---

### FR-5：频谱/声谱图滚动显示

#### 展示形式（推荐）

* **滚动声谱图（Spectrogram/Waterfall）**：

  * 横轴：时间（向左滚动或向右推进）
  * 纵轴：频率 bins（0 ~ Nyquist）
  * 颜色/亮度：幅度（dB）

> 备注：如果只画“瞬时频谱柱状图”，严格来说不需要“滚动”。因此本 spec 将“频谱滚动刷新”解释为声谱图/瀑布图（最贴合需求）。

#### 数据来源

* 前端 AnalyserNode 提供 FFT bins（最省事）
* 或 AudioWorklet 内做 FFT（更可控）

#### 核心要求

* 维护一个固定时长窗口（例如最近 10 秒）的 ring buffer：

  * 每次来一帧就推进一列（或一条扫描线）
* 绘制到 `<canvas>`，保持平滑刷新

**可配置项**

* timeWindowSec：默认 10s
* fftSize：1024/2048（默认 2048）
* freqBinsDisplayed：可降采样显示（例如取前 256/512 bins）
* dynamicRangeDb：例如 [-90dB, -20dB]

**验收点**

* 声谱图持续滚动且不卡死。
* 在安静时整体能量较低；说话时在语音频段能量上升。

---

### FR-6：VAD 信号滚动显示（对照频谱）

* VAD 时间序列必须与声谱图同一个 timeWindow 对齐。
* UI 上至少包含：

  1. probability 曲线（0~1）
  2. 阈值线
  3. 二值 speech 条带（可画在曲线下方）
  4. （可选）start/end 事件标记

**验收点**

* 用户说话时，声谱图能量上升同时 probability 上升，二值进入 speech。
* 停止说话后，概率下降、二值退出 speech（允许按 min_silence 有延迟）。

---

### FR-7：页面交互与控制

必须控件：

* Start / Stop
* 阈值 threshold slider（0~1）
* 清屏/重置（reset buffers）
* 选择 timeWindowSec（5/10/20s）
* 选择 fftSize
* 平滑开关/强度
* 显示 FPS/延迟/丢包率

**验收点**

* Stop 后前端不再发送音频，后端释放 session 并 reset states（若使用 stateful 推理）。
* Reset 后图像从空开始滚动。

---

## 5. 接口与数据协议（API / Protocol）

### 5.1 HTTP

* `GET /` → 返回 `index.html`
* `GET /static/*` → JS/CSS/Worklet 文件

### 5.2 WebSocket

* `WS /ws`

#### 5.2.1 上行：音频 chunk（Client → Server）

建议二进制帧（demo 也可 JSON+base64，但更费带宽/CPU）。

**方案 A：二进制（推荐）**

* Header（固定长度）：

  * magic: 4 bytes (`VAD1`)
  * seq: uint32
  * sample_rate: uint32 (16000)
  * channels: uint16 (1)
  * samples: uint16 (512)
* payload:

  * int16 PCM little-endian，长度 = samples * 2

**方案 B：JSON（易实现，性能差一些）**

```json
{
  "type": "audio_chunk",
  "seq": 1234,
  "sample_rate": 16000,
  "channels": 1,
  "pcm16_base64": "...."
}
```

#### 5.2.2 下行：VAD 结果（Server → Client）

```json
{
  "type": "vad_result",
  "seq": 1234,
  "speech_prob": 0.83,
  "is_speech": true,
  "threshold": 0.5,
  "event": null
}
```

如果启用事件：

```json
{
  "type": "vad_result",
  "seq": 1239,
  "speech_prob": 0.91,
  "is_speech": true,
  "threshold": 0.5,
  "event": { "kind": "speech_start", "time_sec": 12.288 }
}
```

> 注：`time_sec` 计算方式：seq * chunk_duration（32ms）或使用服务端时间戳；demo 以 seq 推导即可。

---

## 6. 性能与非功能需求（Non-Functional Requirements）

### NFR-1：延迟

* 端到端（麦克风采集 → VAD 返回 → UI 更新）目标：**< 300ms**（demo 级别）。
* chunk=32ms，本身就会引入至少一个 chunk 的时间粒度。

### NFR-2：吞吐与刷新率

* 音频 chunk 频率：约 31.25 fps（1000ms / 32ms）
* UI 渲染刷新：建议 requestAnimationFrame（~60fps），但数据推进可按 chunk（~31fps）

### NFR-3：CPU 占用

* Silero VAD 官方宣称 30ms+ chunk 在单 CPU 线程上推理耗时可 <1ms（具体依硬件而定）。([GitHub][1])
  Spec 要求：
* demo 在普通笔记本 CPU 上运行不应导致明显卡顿（可提供性能指标面板）。

### NFR-4：兼容性

* 浏览器：Chrome / Edge 最新版优先
* Python：>=3.8（官方系统需求）([GitHub][1])
* 依赖：torch、（可选 torchaudio / onnxruntime），详见依赖章节([GitHub][1])

### NFR-5：调试

* 落盘音频数据，用于调试。相应记录 VAD 对应结果为 metadata 文件。

---

## 7. 依赖与环境

### 7.1 Python 依赖（最低要求）

* python 3.8+
* torch >= 1.12
* （如用 pip 包）silero-vad
* FastAPI + uvicorn（或 Flask + websockets）
* numpy

Silero VAD 官方列出的示例依赖与系统要求包含 python 3.8+、torch>=1.12.0、以及 torchaudio（用于 I/O）等；如果走 onnxruntime 也可选装。([GitHub][1])

尽量复用当前环境已有版本。

### 7.2 前端依赖

* 原生 HTML + JS（不强制框架）
* Web Audio API（getUserMedia、AudioContext、AnalyserNode、AudioWorklet）
* Canvas 2D 绘图

---

## 8. UI 设计稿（文本版）

页面分区（左右或上下均可）：

**顶部控制栏**

* [Start] [Stop] [Reset]
* Threshold slider（0~1）
* timeWindow、fftSize、smoothing

**主体区域（推荐上下对照，时间轴同向滚动）**

1. 上：滚动声谱图 Canvas（Spectrogram）
2. 下：VAD 轨道 Canvas

   * probability 折线
   * threshold 水平线
   * speech 二值条带（类似 DAW 的 clip 轨）

**右侧（可选）状态面板**

* 当前 seq
* 当前 speech_prob
* is_speech
* 估算延迟（server_ts - client_ts）
* WebSocket 丢包/重连次数

---

## 9. 错误处理与边界条件

* 麦克风不可用/被占用：提示并禁止 Start
* WebSocket 断开：自动重连（可选），并在 UI 显示 disconnected
* 音频 chunk 长度不对：丢弃并计数
* sample_rate 不匹配：前端必须重采样；若仍不匹配服务端拒绝并返回错误
* Stop 时：

  * 前端停止音频节点与 ws 发送
  * 服务端清理 session，并 reset VAD state（若使用 stateful/iterator）

---

## 10. 测试计划（Demo 级）

### 10.1 手工测试

1. 安静环境：probability 长期低于阈值
2. 连续说话：probability 持续高于阈值
3. 间歇说话：能看到 start/end（若启用）与二值条带断续
4. 调整 threshold：阈值越低越敏感，越高越保守
5. 断网/刷新：能恢复到可工作状态（或给出明确错误）

### 10.2 自动化测试（可选）

* 后端：用固定 wav 切成 512-sample chunk，验证输出概率序列长度一致、范围在 [0,1]
* 前端：简单的协议单测（mock ws）

---

## 11. 验收标准（Acceptance Criteria）

必须满足：

* A1：网页授权麦克风后，声谱图与 VAD 轨道均开始**滚动刷新**。
* A2：VAD 结果与频谱在时间轴上基本对齐（同 seq 对应同一帧）。
* A3：说话/静音切换时，VAD probability 与二值信号明显响应。
* A4：Stop/Reset 行为正确，且不会造成后端持续占用资源。
* A5：本地运行说明清晰（README：如何安装依赖、如何启动、浏览器访问地址）。

---

## 12. 可扩展项（Future Work）

* 直接在浏览器端用 ONNX Runtime Web 跑 Silero VAD（减少服务端依赖/延迟）；官方 README 提到有基于浏览器的 VAD 相关社区示例方向。([GitHub][1])
* 加入噪声门限/AGC 选项、以及更稳定的重采样滤波
* 导出最近 N 秒的音频片段与 VAD 标注（用于调参）
* 多路输入设备/多 session 支持
