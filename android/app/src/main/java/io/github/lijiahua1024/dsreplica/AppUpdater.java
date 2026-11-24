/* ============================================================================
 * 功能区：Android 原生容器 / AppUpdater 开始
 * 职责：Android 更新器：版本检查、APK 下载、校验与安装入口。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;

final class AppUpdater {
    private static final String TAG = "AppUpdater";
    static final int INSTALL_SOURCE_SETTINGS = 6;

    private final Activity activity;
    private final PackageInfo installed;
    private final File apk;
    private final Consumer<String> notify;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String snapshot = "{\"phase\":\"idle\"}";
    private UpdateRelease release;
    private String stagedVersion;
    private boolean busy;
    private boolean resumed;
    private boolean awaitingPermission;
    private boolean permissionReturned;

    AppUpdater(Activity activity, Consumer<String> notify) {
        this.activity = activity;
        this.notify = notify;
        installed = UpdateRelease.installed(activity);
        apk = UpdateApkProvider.apk(activity);
        if (apk.isFile()) {
            busy = true;
            snapshot = "{\"phase\":\"checking\"}";
            worker.execute(() -> {
                String version = null;
                try {
                    version = UpdateRelease.verifyApk(activity, installed, apk, null);
                } catch (UpdateRelease.InvalidApk | RuntimeException invalid) {
                    apk.delete();
                }
                String restoredVersion = version;
                post(() -> {
                    busy = false;
                    stagedVersion = restoredVersion;
                    publish();
                });
            });
        }
    }

    String status() { return snapshot; }

    void check() {
        if (busy || !resumed) return;
        busy = true;
        publish("checking", null, null, null);
        worker.execute(() -> {
            try {
                UpdateRelease latest = UpdateRelease.latest(installed.versionName);
                post(() -> {
                    busy = false;
                    release = latest;
                    publish(latest == null ? "current" : null);
                });
            } catch (IOException | JSONException failure) {
                Log.w(TAG, "Release lookup failed: " + failure.getClass().getSimpleName());
                post(() -> {
                    busy = false;
                    publish("checkFailed");
                });
            }
        });
    }

    void update() {
        if (busy || !resumed || awaitingPermission) return;
        if (stagedVersion != null && (release == null || stagedVersion.equals(release.version()))) {
            install(true);
            return;
        }
        if (release == null) return;
        UpdateRelease target = release;
        busy = true;
        publish("downloading", target.version(), 0, null);
        worker.execute(() -> download(target));
    }

    private void download(UpdateRelease target) {
        File temporary = null;
        try {
            File directory = apk.getParentFile();
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No update cache");
            temporary = File.createTempFile("download-", ".apk", directory);
            target.download(temporary, progress ->
                post(() -> publish("downloading", target.version(), progress, null)));
            UpdateRelease.verifyApk(activity, installed, temporary, target.version());
            if (Thread.currentThread().isInterrupted() || !temporary.renameTo(apk)) {
                throw new IOException("Could not stage APK");
            }
            post(() -> {
                busy = false;
                stagedVersion = target.version();
                publish();
                if (resumed) install(true);
            });
        } catch (UpdateRelease.InvalidApk invalid) {
            finishDownload("invalidApk", invalid);
        } catch (IOException | RuntimeException failure) {
            finishDownload("downloadFailed", failure);
        } finally {
            if (temporary != null) temporary.delete();
        }
    }

    private void finishDownload(String message, Exception failure) {
        Log.w(TAG, "Update download failed: " + failure.getClass().getSimpleName());
        post(() -> {
            busy = false;
            publish(message);
        });
    }

    void resume() {
        resumed = true;
        finishPermissionRequest();
    }

    void pause() { resumed = false; }

    void close() { worker.shutdownNow(); }

    void permissionResult() {
        if (!awaitingPermission) return;
        permissionReturned = true;
        finishPermissionRequest();
    }

    private void finishPermissionRequest() {
        if (!resumed || !permissionReturned) return;
        permissionReturned = false;
        awaitingPermission = false;
        install(false);
    }

    private void install(boolean promptForPermission) {
        if (!apk.isFile()) {
            stagedVersion = null;
            publish("apkMissing");
            return;
        }
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            if (!promptForPermission) {
                publish("permissionDenied");
            } else if (!openPermissionSettings(true) && !openPermissionSettings(false)) {
                publish("installerUnavailable");
            }
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(UpdateApkProvider.uri(activity), UpdateApkProvider.MIME_TYPE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException failure) {
            publish("installerUnavailable");
        }
    }

    private boolean openPermissionSettings(boolean appSpecific) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        if (appSpecific) intent.setData(Uri.fromParts("package", installed.packageName, null));
        try {
            activity.startActivityForResult(intent, INSTALL_SOURCE_SETTINGS);
            awaitingPermission = true;
            return true;
        } catch (ActivityNotFoundException | SecurityException failure) {
            return false;
        }
    }

    private void post(Runnable action) {
        activity.runOnUiThread(() -> {
            if (!activity.isDestroyed() && !activity.isFinishing()) action.run();
        });
    }

    private void publish() { publish(null); }

    private void publish(String message) {
        if (stagedVersion != null && (release == null || stagedVersion.equals(release.version()))) {
            publish("ready", stagedVersion, null, message);
        } else if (release != null) {
            publish("available", release.version(), null, message);
        } else {
            publish("idle", null, null, message);
        }
    }

    private void publish(String phase, String version, Integer progress, String message) {
        try {
            JSONObject status = new JSONObject().put("phase", phase)
                .put("version", version).put("progress", progress);
            snapshot = status.toString();
            notify.accept(status.put("message", message).toString());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}


/* ============================================================================
 * 功能区：Android 原生容器 / AppUpdater 结束
 * ========================================================================== */
