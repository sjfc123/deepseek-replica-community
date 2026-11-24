/* ============================================================================
 * 功能区：Android 原生容器 / NativeRecorder 开始
 * 职责：Android 原生录音：临时文件、编码结束与保留/丢弃。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.SequenceInputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

final class NativeRecorder {
    private static final int SAMPLE_RATE = 16000;
    private static final int MAX_BYTES = SAMPLE_RATE * 2 * 120;
    private Capture capture;
    private byte[] result;

    synchronized boolean start() {
        finish(false);
        int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) return false;
        AudioRecord record = null;
        try {
            record = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 2, 4096));
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                record.release();
                return false;
            }
            record.startRecording();
            if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                record.release();
                return false;
            }
            capture = new Capture(record);
            capture.thread.start();
            return true;
        } catch (IllegalStateException | IllegalArgumentException | SecurityException ignored) {
            if (record != null) record.release();
            return false;
        }
    }

    synchronized boolean finish(boolean keep) {
        Capture current = capture;
        capture = null;
        result = null;
        if (current == null) return false;
        current.running = false;
        try {
            current.record.stop();
        } catch (IllegalStateException ignored) {
            // The recording source may already have stopped.
        }
        try {
            current.thread.join(1000);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } finally {
            current.record.release();
        }
        if (!keep || current.thread.isAlive() || current.pcm.size() == 0) return false;
        result = current.pcm.toByteArray();
        return true;
    }

    synchronized double level() { return capture == null ? 0 : capture.level; }

    synchronized WebResourceResponse takeWav() {
        byte[] pcm = result;
        result = null;
        if (pcm == null) return null;
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put(ascii("RIFF")).putInt(36 + pcm.length).put(ascii("WAVEfmt "))
            .putInt(16).putShort((short) 1).putShort((short) 1)
            .putInt(SAMPLE_RATE).putInt(SAMPLE_RATE * 2).putShort((short) 2).putShort((short) 16)
            .put(ascii("data")).putInt(pcm.length);
        return new WebResourceResponse("audio/wav", null, 200, "OK", Map.of("Cache-Control", "no-store"),
            new SequenceInputStream(new ByteArrayInputStream(header.array()), new ByteArrayInputStream(pcm)));
    }

    private static byte[] ascii(String value) {
        return value.getBytes(StandardCharsets.US_ASCII);
    }

    private static final class Capture {
        final AudioRecord record;
        final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
        final Thread thread = new Thread(this::read, "DeepSeekMic");
        volatile boolean running = true;
        volatile double level;

        Capture(AudioRecord record) { this.record = record; }

        void read() {
            byte[] block = new byte[2048];
            short[] samples = new short[block.length / 2];
            while (running && pcm.size() < MAX_BYTES) {
                int count = record.read(samples, 0, Math.min(samples.length, (MAX_BYTES - pcm.size()) / 2));
                if (count <= 0) break;
                double sumSquares = 0;
                for (int index = 0; index < count; index++) {
                    int sample = samples[index];
                    block[index * 2] = (byte) sample;
                    block[index * 2 + 1] = (byte) (sample >> 8);
                    sumSquares += (double) sample * sample;
                }
                pcm.write(block, 0, count * 2);
                level = Math.min(1, Math.sqrt(sumSquares / count) / 4000);
            }
        }
    }
}


/* ============================================================================
 * 功能区：Android 原生容器 / NativeRecorder 结束
 * ========================================================================== */
