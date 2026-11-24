/* ============================================================================
 * 功能区：Android 原生容器 / RecentPhotos 开始
 * 职责：RecentPhotos 原生实现，负责该类的平台能力，并通过 JS 桥或 Intent 与页面交互。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Size;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class RecentPhotos {
    private static final Uri IMAGES = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL);
    private static final Map<String, String> IMAGE_HEADERS = Map.of(
        "Content-Security-Policy", "default-src 'none'; sandbox",
        "X-Content-Type-Options", "nosniff",
        "Cache-Control", "no-store");
    private volatile Map<String, Photo> photos = Map.of();
    private final ContentResolver resolver;

    RecentPhotos(ContentResolver resolver) {
        this.resolver = resolver;
    }

    String list() {
        Map<String, Photo> nextPhotos = new HashMap<>();
        JSONArray result = new JSONArray();
        String[] columns = {MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE};
        String order = MediaStore.Images.Media.DATE_ADDED + " DESC, "
            + MediaStore.Images.Media._ID + " DESC";
        try (Cursor rows = resolver.query(IMAGES, columns, null, null, order)) {
            if (rows == null) {
                photos = Map.of();
                return "[]";
            }
            while (result.length() < 20 && !Thread.currentThread().isInterrupted() && rows.moveToNext()) {
                long id = rows.getLong(0);
                String key = Long.toString(id);
                String name = rows.getString(1);
                String type = rows.getString(2);
                if (name == null || type == null || !type.startsWith("image/")) continue;
                Uri uri = ContentUris.withAppendedId(IMAGES, id);
                // 媒体库可能仍保留已删除文件的索引；跳过这些条目，继续查找可用图片。
                try (ParcelFileDescriptor descriptor = resolver.openFileDescriptor(uri, "r")) {
                    if (descriptor == null) continue;
                } catch (IOException | SecurityException ignored) {
                    continue;
                }
                JSONObject photo = new JSONObject().put("id", key).put("name", name).put("type", type);
                nextPhotos.put(key, new Photo(uri, type));
                result.put(photo);
            }
        } catch (SecurityException | JSONException ignored) {
            photos = Map.of();
            return "[]";
        }
        photos = Map.copyOf(nextPhotos);
        return result.toString();
    }

    WebResourceResponse open(String id, boolean thumbnail) {
        Photo photo = photos.get(id);
        if (photo == null) return null;
        try {
            if (thumbnail) {
                Bitmap bitmap = resolver.loadThumbnail(photo.uri(), new Size(224, 224), null);
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try {
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output);
                } finally {
                    bitmap.recycle();
                }
                return image("image/jpeg", new ByteArrayInputStream(output.toByteArray()));
            }
            if (SelectedPhoto.isHeif(photo.type())) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                SelectedPhoto.writePng(resolver, photo.uri(), output);
                return image("image/png", new ByteArrayInputStream(output.toByteArray()));
            }
            InputStream input = resolver.openInputStream(photo.uri());
            return input == null ? null : image(photo.type(), input);
        } catch (IOException | SecurityException ignored) {
            return null;
        }
    }

    private static WebResourceResponse image(String type, InputStream input) {
        return new WebResourceResponse(type, null, 200, "OK", IMAGE_HEADERS, input);
    }

    private record Photo(Uri uri, String type) {}
}


/* ============================================================================
 * 功能区：Android 原生容器 / RecentPhotos 结束
 * ========================================================================== */
