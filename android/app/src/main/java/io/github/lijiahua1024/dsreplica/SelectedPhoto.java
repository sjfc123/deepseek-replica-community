package io.github.lijiahua1024.dsreplica;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.net.Uri;
import java.io.IOException;
import java.io.OutputStream;

final class SelectedPhoto {
    static boolean isHeif(String mime) {
        return "image/heic".equals(mime) || "image/heif".equals(mime)
            || "image/heic-sequence".equals(mime) || "image/heif-sequence".equals(mime);
    }

    // Android decodes the container and orientation. PNG preserves the pixels for subsequent crops.
    static void writePng(ContentResolver resolver, Uri uri, OutputStream output) throws IOException {
        Bitmap bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri),
            (decoder, info, source) -> {
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                int largest = Math.max(info.getSize().getWidth(), info.getSize().getHeight());
                decoder.setTargetSampleSize(Math.max(1, (int) ((largest + 8191L) / 8192)));
            });
        try {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                throw new IOException("Could not encode selected photo");
            }
        } finally {
            bitmap.recycle();
        }
    }

    private SelectedPhoto() {}
}
