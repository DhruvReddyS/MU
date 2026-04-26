/**
 * TRINETRA — Voice Messages
 * Records audio via MediaRecorder (WebM/Opus), encodes to base64 data URL.
 * Max 20 seconds. Roughly 80–160 KB for a 20s clip at default bitrate.
 */

const MAX_DURATION_MS = 20_000;

let _recorder  = null;
let _chunks    = [];
let _startTime = 0;
let _maxTimer  = null;

export function isVoiceSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

/**
 * Start recording. Returns the MediaRecorder instance.
 * @param {function} onStop - called with { base64, durationMs } when stopped
 * @param {function} onMaxReached - called when 20s limit is hit
 */
export async function startRecording(onStop, onMaxReached) {
  if (_recorder) await stopRecording();

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  _chunks    = [];
  _startTime = Date.now();

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/ogg;codecs=opus';

  _recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });

  _recorder.ondataavailable = (e) => {
    if (e.data.size > 0) _chunks.push(e.data);
  };

  _recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const durationMs = Date.now() - _startTime;
    const blob       = new Blob(_chunks, { type: mimeType });
    _chunks          = [];
    _recorder        = null;
    clearTimeout(_maxTimer);

    const base64 = await _blobToDataUrl(blob);
    onStop?.({ base64, durationMs, mimeType });
  };

  _recorder.start(200); // collect every 200ms

  // Auto-stop at max duration
  _maxTimer = setTimeout(() => {
    onMaxReached?.();
    stopRecording();
  }, MAX_DURATION_MS);
}

export async function stopRecording() {
  clearTimeout(_maxTimer);
  if (_recorder && _recorder.state !== 'inactive') {
    _recorder.stop();
  }
}

export function isRecording() {
  return !!(_recorder && _recorder.state === 'recording');
}

export function getRecordingDuration() {
  if (!_recorder || _recorder.state !== 'recording') return 0;
  return Date.now() - _startTime;
}

function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}
