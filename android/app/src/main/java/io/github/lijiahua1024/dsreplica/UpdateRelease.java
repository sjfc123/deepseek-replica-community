/* ============================================================================
 * 功能区：Android 原生容器 / UpdateRelease 开始
 * 职责：Android 更新配置：更新源、版本比较与下载元信息。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.function.IntConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

record UpdateRelease(String version, URL url, long size, String digest) {
    /** 开源前留空：空仓库地址直接判定已是最新，把更新源交给后续使用者自行填写 */
    private static final String REPOSITORY = "";
    private static final String LATEST = "https://api.github.com/repos/" + REPOSITORY + "/releases/latest";
    private static final String DOWNLOAD = "https://github.com/" + REPOSITORY + "/releases/download/";
    private static final Pattern VERSION = Pattern.compile("(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})");
    private static final long MAX_APK = 256L * 1024 * 1024;

    static UpdateRelease latest(String installedVersion) throws IOException, JSONException {
        if (REPOSITORY.isEmpty()) {
            return null;
        }
        JSONObject release;
        HttpsURLConnection connection = connect(new URL(LATEST));
        try {
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            if (connection.getResponseCode() != 200) throw new IOException("Release lookup failed");
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                long deadline = SystemClock.elapsedRealtime() + 30_000;
                for (int count; (count = input.read(buffer)) != -1;) {
                    checkDeadline(deadline);
                    if (body.size() + count > 512 * 1024) throw new IOException("Release response too large");
                    body.write(buffer, 0, count);
                }
                release = new JSONObject(new String(body.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally {
            connection.disconnect();
        }

        String tag = release.getString("tag_name");
        if (!tag.startsWith("v") || release.optBoolean("draft") || release.optBoolean("prerelease")) {
            throw new IOException("Unexpected release tag");
        }
        String version = tag.substring(1);
        if (compareVersions(version, installedVersion) <= 0) return null;
        String name = "deepseek-app-replica-" + tag + ".apk";
        String expectedUrl = DOWNLOAD + tag + "/" + name;
        JSONArray assets = release.getJSONArray("assets");
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!name.equals(asset.optString("name"))) continue;
            long size = asset.optLong("size");
            String digest = asset.optString("digest");
            if ("uploaded".equals(asset.optString("state")) && size > 0 && size <= MAX_APK
                && expectedUrl.equalsIgnoreCase(asset.optString("browser_download_url"))
                && digest.matches("sha256:[0-9a-f]{64}")) {
                return new UpdateRelease(version, new URL(expectedUrl), size, digest.substring(7));
            }
        }
        throw new IOException("No verifiable APK for the latest release");
    }

    static int compareVersions(String left, String right) throws IOException {
        Matcher a = VERSION.matcher(left == null ? "" : left);
        Matcher b = VERSION.matcher(right == null ? "" : right);
        if (!a.matches() || !b.matches()) throw new IOException("Invalid release version");
        for (int i = 1; i <= 3; i++) {
            int order = Integer.compare(Integer.parseInt(a.group(i)), Integer.parseInt(b.group(i)));
            if (order != 0) return order;
        }
        return 0;
    }

    void download(File file, IntConsumer progress) throws IOException, InvalidApk {
        MessageDigest hash;
        try {
            hash = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
        URL next = url;
        for (int redirect = 0; redirect < 5; redirect++) {
            HttpsURLConnection connection = connect(next);
            try {
                int status = connection.getResponseCode();
                if (status == 200) {
                    copyApk(connection, file, hash, progress);
                    return;
                }
                String location = connection.getHeaderField("Location");
                if (status < 300 || status >= 400 || location == null) break;
                next = new URL(next, location);
                if (!"release-assets.githubusercontent.com".equalsIgnoreCase(next.getHost())
                    && !"objects.githubusercontent.com".equalsIgnoreCase(next.getHost())) break;
            } finally {
                connection.disconnect();
            }
        }
        throw new IOException("APK download failed");
    }

    private void copyApk(HttpsURLConnection connection, File file, MessageDigest hash,
                         IntConsumer progress) throws IOException, InvalidApk {
        try (InputStream input = connection.getInputStream();
             DigestOutputStream output = new DigestOutputStream(new FileOutputStream(file), hash)) {
            byte[] buffer = new byte[32 * 1024];
            long downloaded = 0;
            int lastProgress = 0;
            long deadline = SystemClock.elapsedRealtime() + 300_000;
            for (int count; (count = input.read(buffer)) != -1;) {
                checkDeadline(deadline);
                downloaded += count;
                if (downloaded > size) throw new InvalidApk();
                output.write(buffer, 0, count);
                int percent = (int) (downloaded * 100 / size);
                if (percent >= lastProgress + 5 && percent < 100) {
                    progress.accept(percent);
                    lastProgress = percent;
                }
            }
            byte[] actual = hash.digest();
            if (downloaded != size || !MessageDigest.isEqual(parseDigest(digest), actual)) {
                throw new InvalidApk();
            }
        }
    }

    private static byte[] parseDigest(String digest) {
        byte[] bytes = new byte[32];
        for (int i = 0; i < bytes.length; i++) {
            bytes[i] = (byte) Integer.parseInt(digest.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    }

    private static HttpsURLConnection connect(URL url) throws IOException {
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null
            || (url.getPort() != -1 && url.getPort() != 443)) {
            throw new IOException("Invalid update URL");
        }
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(15_000);
        connection.setRequestProperty("User-Agent", "DeepSeek-App-Replica");
        return connection;
    }

    private static void checkDeadline(long deadline) throws IOException {
        if (Thread.currentThread().isInterrupted() || SystemClock.elapsedRealtime() >= deadline) {
            throw new IOException("Update request interrupted");
        }
    }

    static PackageInfo installed(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(),
                PackageManager.GET_SIGNING_CERTIFICATES);
        } catch (PackageManager.NameNotFoundException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    static String verifyApk(Context context, PackageInfo installed, File file, String version)
        throws InvalidApk {
        PackageInfo apk = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),
            PackageManager.GET_SIGNING_CERTIFICATES);
        if (apk == null || !installed.packageName.equals(apk.packageName) || apk.versionName == null
            || (version != null && !version.equals(apk.versionName))
            || apk.getLongVersionCode() <= installed.getLongVersionCode()
            || apk.applicationInfo == null || apk.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT
            || apk.signingInfo == null || installed.signingInfo == null) {
            throw new InvalidApk();
        }
        Signature[] existing = installed.signingInfo.getApkContentsSigners();
        Signature[] incoming = apk.signingInfo.getApkContentsSigners();
        if (existing == null || existing.length == 0 || incoming == null || incoming.length == 0) {
            throw new InvalidApk();
        }
        boolean sameSigners = new HashSet<>(Arrays.asList(existing))
            .equals(new HashSet<>(Arrays.asList(incoming)));
        Signature[] history = apk.signingInfo.getSigningCertificateHistory();
        boolean rotated = existing.length == 1 && incoming.length == 1 && history != null
            && Arrays.asList(history).contains(existing[0]);
        if (!sameSigners && !rotated) throw new InvalidApk();
        return apk.versionName;
    }

    static final class InvalidApk extends Exception {}
}


/* ============================================================================
 * 功能区：Android 原生容器 / UpdateRelease 结束
 * ========================================================================== */
