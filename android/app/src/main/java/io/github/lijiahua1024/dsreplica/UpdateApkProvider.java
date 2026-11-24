/* ============================================================================
 * 功能区：Android 原生容器 / UpdateApkProvider 开始
 * 职责：UpdateApkProvider 原生实现，负责该类的平台能力，并通过 JS 桥或 Intent 与页面交互。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

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

public final class UpdateApkProvider extends ContentProvider {
    static final String MIME_TYPE = "application/vnd.android.package-archive";
    private static final String NAME = "deepseek-app-replica-update.apk";

    static File apk(Context context) {
        return new File(new File(context.getCacheDir(), "app-update"), NAME);
    }

    static Uri uri(Context context) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".update")
            .appendPath(NAME).build();
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        return uri(getContext()).equals(uri) ? MIME_TYPE : null;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) || !uri(getContext()).equals(uri)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(apk(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] arguments, String order) {
        String[] columns = projection == null
            ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        File apk = apk(getContext());
        if (uri(getContext()).equals(uri) && apk.isFile()) {
            MatrixCursor.RowBuilder row = cursor.newRow();
            for (String column : columns) {
                if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(NAME);
                else if (OpenableColumns.SIZE.equals(column)) row.add(apk.length());
                else row.add(null);
            }
        }
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] arguments) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] arguments) { throw new UnsupportedOperationException(); }
}


/* ============================================================================
 * 功能区：Android 原生容器 / UpdateApkProvider 结束
 * ========================================================================== */
