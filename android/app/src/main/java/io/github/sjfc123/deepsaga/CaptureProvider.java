/* ============================================================================
 * 功能区：Android 原生容器 / CaptureProvider 开始
 * 职责：CaptureProvider 原生实现，负责该类的平台能力，并通过 JS 桥或 Intent 与页面交互。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

package io.github.sjfc123.deepsaga;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

public final class CaptureProvider extends ContentProvider {
    static Uri create(Context context) throws IOException {
        return create(context, ".jpg");
    }

    static Uri createPng(Context context) throws IOException {
        return create(context, ".png");
    }

    private static Uri create(Context context, String extension) throws IOException {
        File folder = directory(context);
        File[] old = folder.listFiles(file -> file.lastModified() < System.currentTimeMillis() - 86_400_000);
        if (old != null) {
            for (File file : old) file.delete();
        }
        File photo = File.createTempFile("photo-", extension, folder);
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".capture")
            .appendPath(photo.getName()).build();
    }

    private static File directory(Context context) {
        File folder = new File(context.getCacheDir(), "camera-captures");
        folder.mkdirs();
        return folder;
    }

    private File file(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (uri.getPathSegments().size() != 1 || name == null || !name.matches("photo-[0-9]+\\.(jpg|png)")) {
            throw new FileNotFoundException();
        }
        File result = new File(directory(getContext()), name);
        if (!result.isFile()) throw new FileNotFoundException();
        return result;
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        return name != null && name.endsWith(".png") ? "image/png" : "image/jpeg";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] arguments,
                        String order) {
        String[] columns = projection == null
            ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        try {
            File photo = file(uri);
            MatrixCursor.RowBuilder row = cursor.newRow();
            for (String column : columns) {
                if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(photo.getName());
                else if (OpenableColumns.SIZE.equals(column)) row.add(photo.length());
                else row.add(null);
            }
        } catch (FileNotFoundException ignored) {
            // There is no row for an expired capture.
        }
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}


/* ============================================================================
 * 功能区：Android 原生容器 / CaptureProvider 结束
 * ========================================================================== */
