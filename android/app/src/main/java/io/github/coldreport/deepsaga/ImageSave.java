/* ============================================================================
 * 功能区：Android 原生容器 / ImageSave 开始
 * 职责：ImageSave 原生实现，负责该类的平台能力，并通过 JS 桥或 Intent 与页面交互。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

package io.github.coldreport.deepsaga;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import java.util.Locale;

/** An image becomes visible in the system gallery only after its original bytes are saved. */
final class ImageSave {
    private final ContentResolver resolver;
    private final FileExport writer;
    private Uri pending;

    ImageSave(ContentResolver resolver) {
        this.resolver = resolver;
        writer = new FileExport(resolver);
    }

    synchronized boolean begin(String name, String mime) {
        if (pending != null) return false;
        name = name.replace('/', '_').replace('\\', '_');
        if (name.trim().isEmpty()) return false;
        if (!mime.startsWith("image/")) {
            int dot = name.lastIndexOf('.');
            if (dot < 0) return false;
            mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(
                name.substring(dot + 1).toLowerCase(Locale.ROOT));
            if (mime == null || !mime.startsWith("image/")) return false;
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, mime);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES);
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        try {
            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            pending = resolver.insert(collection, values);
            if (pending != null && writer.open(pending)) return true;
        } catch (RuntimeException ignored) {
            // A device without writable media storage cannot save the image.
        }
        finish(false);
        return false;
    }

    synchronized boolean append(String bytes) {
        return writer.append(bytes);
    }

    synchronized boolean finish(boolean keep) {
        Uri image = pending;
        if (image == null) return false;
        pending = null;
        boolean closed = writer.close();
        if (keep && closed) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            try {
                if (resolver.update(image, values, null, null) == 1) return true;
            } catch (RuntimeException ignored) {
                // Remove an unpublished image if the provider could not publish it.
            }
        }
        try {
            resolver.delete(image, null, null);
        } catch (RuntimeException ignored) {
            // Pending entries are hidden from the gallery and expire automatically.
        }
        return false;
    }
}


/* ============================================================================
 * 功能区：Android 原生容器 / ImageSave 结束
 * ========================================================================== */
