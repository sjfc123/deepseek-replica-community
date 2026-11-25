/* ============================================================================
 * 功能区：Android 原生容器 / CallAudioCapture 开始
 * 职责：Android 通话采集：AudioRecord 读取、状态上报与线程退出。
 * ========================================================================== */

package io.github.sjfc123.deepsaga;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.util.ArrayDeque;

/**
 * 通话模式的系统直录通道。
 *
 * WebView 的 getUserMedia 在少数 ROM 上会被内核拦下，而此时 AudioRecord 本身仍可用。
 * 该类以 16 kHz 单声道持续采集，JS 侧按帧轮询读取 PCM，继续复用同一套断句与转写逻辑。
 * 队列保留最近约一秒的数据，页面轮询变慢时丢旧帧，避免延迟持续累积。
 */
final class CallAudioCapture {
    private static final int SAMPLE_RATE = 16000;
    private static final int BLOCK_SAMPLES = 2048;
    private static final int MAX_QUEUED_BLOCKS = 8;

    private AudioRecord record;
    private Thread thread;
    private volatile boolean running;
    private volatile String lastError = "";
    private final ArrayDeque<byte[]> queue = new ArrayDeque<>();

    synchronized boolean start() {
        stop();
        lastError = "";
        int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) return false;
        try {
            record = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                Math.max(min * 2, BLOCK_SAMPLES * 4));
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                record.release();
                record = null;
                return false;
            }
            record.startRecording();
            if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                record.release();
                record = null;
                return false;
            }
        } catch (IllegalStateException | IllegalArgumentException | SecurityException failure) {
            lastError = failure.getClass().getSimpleName() + ": " + failure.getMessage();
            if (record != null) record.release();
            record = null;
            return false;
        }
        running = true;
        thread = new Thread(this::readLoop, "DeepSeekCallCapture");
        thread.start();
        return true;
    }

    synchronized void stop() {
        running = false;
        AudioRecord current = record;
        record = null;
        if (current != null) {
            try {
                current.stop();
            } catch (IllegalStateException ignored) {
                // 通道可能已被系统回收，停止失败不影响释放。
            }
        }
        Thread worker = thread;
        thread = null;
        if (worker != null && worker.isAlive()) {
            try {
                worker.join(400);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
        if (current != null) current.release();
        synchronized (queue) {
            queue.clear();
        }
    }

    /**
     * 取出已采集的 PCM16LE，按字节顺序拼接后交给 JS；没有数据时返回空串。
     * Android 13 之前不存在 ByteArrayOutputStream.writeBytes(byte[])，因此使用 API 1 起可用的
     * write(byte[], int, int)，避免旧系统在首次读取时抛 NoSuchMethodError。
     * 返回值以 ERR| 开头表示通道异常，调用方据此重新建立采集或结束通话，不让异常穿过 JS 桥。
     */
    String read() {
        try {
            byte[] pcm;
            synchronized (queue) {
                if (queue.isEmpty()) return "";
                ByteArrayOutputStream output = new ByteArrayOutputStream(queue.size() * BLOCK_SAMPLES * 2);
                while (!queue.isEmpty()) {
                    byte[] block = queue.pollFirst();
                    if (block != null) output.write(block, 0, block.length);
                }
                pcm = output.toByteArray();
            }
            return Base64.encodeToString(pcm, Base64.NO_WRAP);
        } catch (Throwable failure) {
            lastError = failure.getClass().getSimpleName() + ": " + failure.getMessage();
            return "ERR|" + sanitize(lastError);
        }
    }

    /** 通道状态：running|queued|lastError，供页面判断是暂时无数据还是采集线程已退出 */
    String status() {
        int queued;
        synchronized (queue) {
            queued = queue.size();
        }
        return (running ? "1" : "0") + "|" + queued + "|" + sanitize(lastError);
    }

    private static String sanitize(String value) {
        return value == null ? "" : value.replace('|', ' ').replace('\n', ' ').replace('\r', ' ');
    }

    private void readLoop() {
        short[] samples = new short[BLOCK_SAMPLES];
        while (running) {
            AudioRecord current = record;
            if (current == null) {
                lastError = "AudioRecord released";
                break;
            }
            int count;
            try {
                count = current.read(samples, 0, BLOCK_SAMPLES);
            } catch (Throwable failure) {
                lastError = failure.getClass().getSimpleName() + ": " + failure.getMessage();
                break;
            }
            if (count < 0) {
                lastError = "AudioRecord.read=" + count;
                break;
            }
            if (count == 0) {
                try {
                    Thread.sleep(10);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    break;
                }
                continue;
            }
            byte[] block = new byte[count * 2];
            for (int index = 0; index < count; index++) {
                int sample = samples[index];
                block[index * 2] = (byte) sample;
                block[index * 2 + 1] = (byte) (sample >> 8);
            }
            synchronized (queue) {
                if (queue.size() >= MAX_QUEUED_BLOCKS) queue.pollFirst();
                queue.addLast(block);
            }
        }
        running = false;
    }
}


/* ============================================================================
 * 功能区：Android 原生容器 / CallAudioCapture 结束
 * ========================================================================== */
