package io.github.lijiahua1024.dsreplica;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipFile;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 自动备份写入公共下载目录（MediaStore Downloads），无需存储权限（minSdk 29）。
 *
 * 写入分两步：先写应用缓存里的 .part 临时文件，核对大小并用 ZipFile 打开中央目录，
 * 确认 ZIP 完整后才发布到下载目录。这样下载目录里不会出现写了一半的文件；
 * 历史版本留下的 pending、截断或空文件会在下次查询/清理时删除。
 *
 * RELATIVE_PATH 必须带 Environment.DIRECTORY_DOWNLOADS 前缀（"Download/..."）。
 */
final class AutoBackup {
    private static final String FOLDER = "DeepSeek Replica/自动备份";
    private static final String RELATIVE_PATH = Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER;
    /** 查询按子目录匹配，兼容带或不带 Download 前缀、末尾斜杠不同的设备 */
    private static final String PATH_FILTER = "%" + FOLDER + "%";
    private static final String NAME_PREFIX = "deepseek_data-";
    private static final int KEEP = 5;
    private static final int COPY_BUFFER = 64 * 1024;

    private final ContentResolver resolver;
    private final File stagingDir;
    private File stagingFile;
    private OutputStream output;
    private long expectedSize = -1;
    private long written;
    private String displayName = "";
    private boolean failed;
    private String lastError = "";

    AutoBackup(ContentResolver resolver, File stagingDir) {
        this.resolver = resolver;
        this.stagingDir = stagingDir;
    }

    /** 新建临时文件；返回可展示路径，null 表示写入不可用 */
    synchronized String begin(String name, long size) {
        close();
        failed = false;
        lastError = "";
        written = 0;
        expectedSize = size;
        if (name == null || !name.startsWith(NAME_PREFIX) || !name.endsWith(".zip")
            || name.contains("/") || name.contains("\\")) {
            lastError = "备份文件名不合法";
            return null;
        }
        if (size <= 0) {
            lastError = "备份内容为空";
            return null;
        }
        cleanupStalePending();
        cleanupStaging();
        displayName = name;
        try {
            if (!stagingDir.exists() && !stagingDir.mkdirs()) {
                lastError = "无法创建应用缓存目录";
                return null;
            }
            File temp = new File(stagingDir, "auto-backup-" + System.currentTimeMillis() + ".part");
            OutputStream stream = new BufferedOutputStream(new FileOutputStream(temp));
            stagingFile = temp;
            output = stream;
            return RELATIVE_PATH + "/" + name;
        } catch (IOException | RuntimeException error) {
            lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
            cleanupStaging();
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
            byte[] chunk = Base64.decode(base64, Base64.NO_WRAP);
            if (expectedSize > 0 && written + chunk.length > expectedSize) {
                failed = true;
                lastError = "写入内容超过预期大小";
                return false;
            }
            output.write(chunk);
            written += chunk.length;
            return true;
        } catch (IOException | IllegalArgumentException error) {
            failed = true;
            lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
            return false;
        }
    }

    /**
     * 收尾：先核对大小并校验 ZIP 中央目录，再把完整文件复制到下载目录。
     * 任一步失败都会删除临时文件和 pending 条目，返回 false。
     */
    synchronized boolean finish() {
        if (output == null || stagingFile == null) {
            if (lastError.isEmpty()) lastError = "没有待写入的文件";
            return false;
        }
        boolean closed = false;
        try {
            output.close();
            closed = true;
        } catch (IOException error) {
            lastError = "close: " + error.getMessage();
        } finally {
            output = null;
        }
        File temp = stagingFile;
        if (!closed || failed) {
            cleanupStaging();
            if (lastError.isEmpty()) lastError = "写入中断，已丢弃临时文件";
            return false;
        }
        long size = temp.length();
        if (expectedSize > 0 && size != expectedSize) {
            lastError = "校验失败：文件不完整，写入 " + size + " 字节，预期 " + expectedSize + " 字节";
            cleanupStaging();
            return false;
        }
        if (!isCompleteZip(temp)) {
            cleanupStaging();
            if (lastError.isEmpty()) lastError = "ZIP 校验失败，已丢弃临时文件";
            return false;
        }
        boolean published = publish(temp);
        cleanupStaging();
        expectedSize = -1;
        written = 0;
        return published;
    }

    /** 上一次失败的原生原因，页面用来给出可读提示 */
    synchronized String error() {
        return lastError;
    }

    /** 最近一次完整备份的元信息；顺带清掉 pending、截断和超量的旧文件 */
    synchronized String status() {
        cleanupStalePending();
        Cursor cursor = null;
        List<Uri> stale = new ArrayList<>();
        String latest = null;
        try {
            cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{
                    MediaStore.Downloads._ID,
                    MediaStore.Downloads.DISPLAY_NAME,
                    MediaStore.Downloads.DATE_ADDED,
                    MediaStore.Downloads.SIZE
                },
                MediaStore.Downloads.RELATIVE_PATH + " LIKE ? AND "
                    + MediaStore.Downloads.IS_PENDING + " = 0",
                new String[]{PATH_FILTER},
                MediaStore.Downloads.DATE_ADDED + " DESC");
            if (cursor == null) return "null";
            int valid = 0;
            while (cursor.moveToNext()) {
                Uri uri = Uri.withAppendedPath(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getString(0));
                String name = cursor.getString(1);
                long date = cursor.getLong(2) * 1000L;
                long size = cursor.getLong(3);
                if (!isBackupName(name) || !looksComplete(uri, size) || valid >= KEEP) {
                    stale.add(uri);
                    continue;
                }
                if (latest == null) {
                    JSONObject info = new JSONObject();
                    try {
                        info.put("name", name);
                        info.put("date", date);
                        info.put("size", size);
                        latest = info.toString();
                    } catch (JSONException ignored) {
                        stale.add(uri);
                    }
                }
                valid++;
            }
        } catch (RuntimeException ignored) {
            // 查询失败按无备份处理，不误报。
        } finally {
            if (cursor != null) cursor.close();
        }
        deleteAll(stale);
        return latest == null ? "null" : latest;
    }

    /** 仅保留最近 keep 份完整备份；无效文件优先删除 */
    synchronized void prune(int keep) {
        cleanupStalePending();
        Cursor cursor = null;
        List<Uri> stale = new ArrayList<>();
        try {
            cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{
                    MediaStore.Downloads._ID,
                    MediaStore.Downloads.DISPLAY_NAME,
                    MediaStore.Downloads.SIZE
                },
                MediaStore.Downloads.RELATIVE_PATH + " LIKE ? AND "
                    + MediaStore.Downloads.IS_PENDING + " = 0",
                new String[]{PATH_FILTER},
                MediaStore.Downloads.DATE_ADDED + " DESC");
            if (cursor == null) return;
            int index = 0;
            while (cursor.moveToNext()) {
                Uri uri = Uri.withAppendedPath(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getString(0));
                String name = cursor.getString(1);
                long size = cursor.getLong(2);
                if (!isBackupName(name) || !looksComplete(uri, size) || index++ >= keep) {
                    stale.add(uri);
                }
            }
        } catch (RuntimeException ignored) {
            // 清理失败不阻断备份流程。
        } finally {
            if (cursor != null) cursor.close();
        }
        deleteAll(stale);
    }

    synchronized void close() {
        failed = false;
        if (output != null) {
            try {
                output.close();
            } catch (IOException ignored) {
                // 连接已断开。
            } finally {
                output = null;
            }
        }
        cleanupStaging();
        expectedSize = -1;
        written = 0;
    }

    /** 把完整临时文件复制进下载目录；复制字节数不符时回滚 pending 条目 */
    private boolean publish(File file) {
        Uri uri = null;
        OutputStream target = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
            values.put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_PATH);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            values.put(MediaStore.Downloads.DISPLAY_NAME, displayName);
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                lastError = "insert 返回空 URI，下载目录不可写";
                return false;
            }
            target = resolver.openOutputStream(uri, "w");
            if (target == null) {
                lastError = "openOutputStream 返回空";
                delete(uri);
                return false;
            }
            long copied = 0;
            try (InputStream source = new BufferedInputStream(new FileInputStream(file))) {
                byte[] buffer = new byte[COPY_BUFFER];
                int read;
                while ((read = source.read(buffer)) != -1) {
                    target.write(buffer, 0, read);
                    copied += read;
                }
            }
            target.close();
            target = null;
            if (copied != file.length()) {
                lastError = "发布字节数不符：复制 " + copied + " / " + file.length();
                delete(uri);
                return false;
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            int updated = resolver.update(uri, done, null, null);
            if (updated <= 0) {
                lastError = "系统未确认备份文件，已删除 pending 条目";
                delete(uri);
                return false;
            }
            return true;
        } catch (IOException | RuntimeException error) {
            lastError = "publish: " + error.getClass().getSimpleName() + ": " + error.getMessage();
            if (target != null) {
                try {
                    target.close();
                } catch (IOException ignored) {
                    // 忽略关闭失败。
                }
            }
            if (uri != null) delete(uri);
            return false;
        }
    }

    /** 用 ZIP 中央目录判断文件是否完整；截断文件会在这里抛出异常 */
    private boolean isCompleteZip(File file) {
        try (ZipFile zip = new ZipFile(file)) {
            return zip.size() > 0;
        } catch (IOException | RuntimeException error) {
            lastError = "ZIP 校验失败：" + error.getMessage();
            return false;
        }
    }

    /** 只读文件头与 EOCD，确认下载目录里的旧文件没有被截断 */
    private boolean looksComplete(Uri uri, long size) {
        if (size < 22) return false;
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) return false;
            byte[] head = new byte[4];
            if (!readFully(input, head)) return false;
            if (head[0] != 'P' || head[1] != 'K' || head[2] != 3 || head[3] != 4) return false;
            long remaining = size - 22;
            while (remaining > 0) {
                long skipped = input.skip(remaining);
                if (skipped > 0) {
                    remaining -= skipped;
                } else if (input.read() == -1) {
                    return false;
                } else {
                    remaining--;
                }
            }
            byte[] tail = new byte[22];
            if (!readFully(input, tail)) return false;
            return tail[0] == 'P' && tail[1] == 'K' && tail[2] == 5 && tail[3] == 6;
        } catch (IOException | RuntimeException ignored) {
            return false;
        }
    }

    private static boolean readFully(InputStream input, byte[] target) throws IOException {
        int offset = 0;
        while (offset < target.length) {
            int read = input.read(target, offset, target.length - offset);
            if (read == -1) return false;
            offset += read;
        }
        return true;
    }

    private static boolean isBackupName(String name) {
        return name != null && name.startsWith(NAME_PREFIX) && name.endsWith(".zip");
    }

    private void cleanupStalePending() {
        Cursor cursor = null;
        List<Uri> stale = new ArrayList<>();
        try {
            // 不依赖厂商对 pending 选择条件的支持：先按目录取出，再逐条读状态。
            cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{
                    MediaStore.Downloads._ID,
                    MediaStore.Downloads.IS_PENDING
                },
                MediaStore.Downloads.RELATIVE_PATH + " LIKE ?",
                new String[]{PATH_FILTER},
                null);
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                if (cursor.getInt(1) == 1) {
                    stale.add(Uri.withAppendedPath(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getString(0)));
                }
            }
        } catch (RuntimeException ignored) {
            // 查询失败时不影响新文件发布。
        } finally {
            if (cursor != null) cursor.close();
        }
        deleteAll(stale);
    }

    private void cleanupStaging() {
        if (stagingFile != null) {
            try {
                if (stagingFile.exists()) stagingFile.delete();
            } catch (SecurityException ignored) {
                // 缓存文件删不掉时留待系统清理。
            }
            stagingFile = null;
        }
        displayName = "";
    }

    private void deleteAll(List<Uri> uris) {
        for (Uri uri : uris) delete(uri);
    }

    private void delete(Uri uri) {
        try {
            resolver.delete(uri, null, null);
        } catch (RuntimeException ignored) {
            // 单条删除失败不影响其他文件。
        }
    }
}
