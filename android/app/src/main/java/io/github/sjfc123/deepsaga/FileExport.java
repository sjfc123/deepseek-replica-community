/* ============================================================================
 * 功能区：Android 原生容器 / FileExport 开始
 * 职责：FileExport 原生实现，负责该类的平台能力，并通过 JS 桥或 Intent 与页面交互。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

package io.github.sjfc123.deepsaga;

import android.content.ContentResolver;
import android.net.Uri;
import android.util.Base64;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;

final class FileExport {
    private final ContentResolver resolver;
    private OutputStream output;

    FileExport(ContentResolver resolver) {
        this.resolver = resolver;
    }

    synchronized boolean open(Uri destination) {
        close();
        try {
            OutputStream stream = resolver.openOutputStream(destination, "wt");
            if (stream == null) return false;
            output = new BufferedOutputStream(stream);
            return true;
        } catch (IOException | SecurityException ignored) {
            return false;
        }
    }

    synchronized boolean append(String base64) {
        if (output == null || base64.length() > 65536) return false;
        try {
            output.write(Base64.decode(base64, Base64.NO_WRAP));
            return true;
        } catch (IOException | IllegalArgumentException ignored) {
            close();
            return false;
        }
    }

    synchronized boolean close() {
        if (output == null) return false;
        try {
            output.close();
            return true;
        } catch (IOException ignored) {
            return false;
        } finally {
            output = null;
        }
    }
}


/* ============================================================================
 * 功能区：Android 原生容器 / FileExport 结束
 * ========================================================================== */
