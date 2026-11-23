package io.github.lijiahua1024.dsreplica;

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
