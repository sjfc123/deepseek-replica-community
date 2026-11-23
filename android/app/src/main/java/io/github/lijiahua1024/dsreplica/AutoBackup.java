package io.github.lijiahua1024.dsreplica;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 自动备份写入公共下载目录（MediaStore Downloads），无需存储权限（minSdk 29）。
 * 用途：覆盖安装、更换签名重装或系统清理后，仍可从「下载」目录恢复历史。
 *
 * RELATIVE_PATH 必须带 Environment.DIRECTORY_DOWNLOADS 前缀（"Download/..."）。
 * 只写子目录时部分设备 insert 直接返回 null，表现为「备份没成功」。
 */
final class AutoBackup {
    private static final String FOLDER = "DeepSeek Replica/自动备份";
    private static final String RELATIVE_PATH = Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER;
    /** 查询只认子目录部分，兼容旧版没有 Download 前缀留下的文件 */
    private static final String PATH_FILTER = FOLDER + "%";
    private final ContentResolver resolver;
    private Uri pendingUri;
    private OutputStream output;
    private boolean failed;
    private String lastError = "";

    AutoBackup(ContentResolver resolver) {
        this.resolver = resolver;
    }

    /** 新建备份文件并返回可展示路径；返回 null 表示写入不可用 */
    synchronized String begin(String name) {
        close();
        failed = false;
        lastError = "";
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
            values.put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_PATH);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                lastError = "insert 返回空 URI，下载目录不可写";
                return null;
            }
            OutputStream stream = resolver.openOutputStream(uri, "wt");
            if (stream == null) {
                resolver.delete(uri, null, null);
                lastError = "openOutputStream 返回空";
                return null;
            }
            pendingUri = uri;
            output = new BufferedOutputStream(stream);
            return RELATIVE_PATH + "/" + name;
        } catch (IOException | RuntimeException error) {
            lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
            return null;
        }
    }

    synchronized boolean append(String base64) {
        if (output == null || base64.length() > 65536) {
            failed = true;
            lastError = "写入通道未打开或分片过大";
            return false;
        }
        try {
            output.write(Base64.decode(base64, Base64.NO_WRAP));
            return true;
        } catch (IOException | IllegalArgumentException error) {
            failed = true;
            lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
            return false;
        }
    }

    /** 收尾并解除 pending 状态；返回 true 表示文件已落盘且可被其他应用读取 */
    synchronized boolean finish() {
        if (output == null || pendingUri == null) {
            if (lastError.isEmpty()) lastError = "没有待写入的文件";
            return false;
        }
        boolean written = false;
        try {
            output.close();
            written = true;
        } catch (IOException error) {
            lastError = "close: " + error.getMessage();
        } finally {
            output = null;
        }
        Uri uri = pendingUri;
        pendingUri = null;
        if (!written || failed) {
            try {
                resolver.delete(uri, null, null);
            } catch (RuntimeException ignored) {
                // 删除失败时保留未完成文件，下次启动会覆盖同名文件。
            }
            if (lastError.isEmpty()) lastError = "写入中断，已删除半截文件";
            return false;
        }
        try {
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return true;
        } catch (RuntimeException error) {
            lastError = "update: " + error.getMessage();
            return false;
        }
    }

    /** 上一次失败的原生原因，页面用来给出可读提示 */
    synchronized String error() {
        return lastError;
    }

    /** 最近一次备份的元信息，供页面显示上次备份信息 */
    synchronized String status() {
        Cursor cursor = null;
        try {
            cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{
                    MediaStore.Downloads.DISPLAY_NAME,
                    MediaStore.Downloads.DATE_ADDED,
                    MediaStore.Downloads.SIZE
                },
                MediaStore.Downloads.RELATIVE_PATH + " LIKE ?",
                new String[]{PATH_FILTER},
                MediaStore.Downloads.DATE_ADDED + " DESC");
            if (cursor == null || !cursor.moveToFirst()) return "null";
            JSONObject info = new JSONObject();
            try {
                info.put("name", cursor.getString(0));
                info.put("date", cursor.getLong(1) * 1000L);
                info.put("size", cursor.getLong(2));
            } catch (JSONException ignored) {
                return "null";
            }
            return info.toString();
        } catch (RuntimeException ignored) {
            return "null";
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /** 仅保留最近 keep 份，避免长期累积占用空间 */
    synchronized void prune(int keep) {
        Cursor cursor = null;
        try {
            cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Downloads._ID},
                MediaStore.Downloads.RELATIVE_PATH + " LIKE ?",
                new String[]{PATH_FILTER},
                MediaStore.Downloads.DATE_ADDED + " DESC");
            if (cursor == null) return;
            int index = 0;
            while (cursor.moveToNext()) {
                if (index++ < keep) continue;
                Uri uri = Uri.withAppendedPath(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getString(0));
                try {
                    resolver.delete(uri, null, null);
                } catch (RuntimeException ignored) {
                    // 单条删除失败不影响其他文件。
                }
            }
        } catch (RuntimeException ignored) {
            // 清理失败不阻断备份流程。
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    synchronized void close() {
        failed = false;
        if (output == null) {
            if (pendingUri != null) {
                try {
                    resolver.delete(pendingUri, null, null);
                } catch (RuntimeException ignored) {
                    // 忽略清理失败。
                }
                pendingUri = null;
            }
            return;
        }
        try {
            output.close();
        } catch (IOException ignored) {
            // 连接已断开。
        } finally {
            output = null;
            if (pendingUri != null) {
                try {
                    resolver.delete(pendingUri, null, null);
                } catch (RuntimeException ignored) {
                    // 忽略清理失败。
                }
                pendingUri = null;
            }
        }
    }
}
