/* ============================================================================
 * 功能区：Android 原生容器 / MainActivity 开始
 * 职责：Android 主 Activity：WebView 生命周期、权限、文件选择、JS 桥与媒体采集。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.StatFs;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.view.accessibility.AccessibilityManager;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.File;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + ASSET_HOST + "/index.html";
    private static final String PROFILE_KEY = "profile";
    private static final int MICROPHONE = 1;
    private static final int FILE_CHOOSER = 2;
    private static final int PHOTOS = 3;
    private static final int CAMERA = 4;
    private static final int EXPORT_HISTORY = 5;
    /** 通话前主动申请录音权限；与原生录音共用同一声明，通过独立回调区分 */
    private static final int MICROPHONE_CALL = 6;
    /** WebView 音频采集请求等待系统授权 */
    private static final int MICROPHONE_WEB = 7;
    private WebView webView;
    private FrameLayout frame;
    private ApiKeyStore keys;
    private ApiKeyStore chatConfig;
    private final CustomChatTransport customChat = new CustomChatTransport();
    private SharedPreferences profilePreferences;
    private ValueCallback<Uri[]> fileCallback;
    private boolean choosingPhotos;
    /** WebView onPermissionRequest 暂存的音频请求，待系统授权后授予 */
    private PermissionRequest pendingAudioRequest;
    /** 通话期间申请的音频焦点，挂断时必须释放 */
    private AudioFocusRequest callFocus;
    private boolean keyboardVisible;
    private volatile float statusInset;
    private volatile float buttonNavigationInset;
    private boolean askedForPhotos;
    private Uri capture;
    private RecentPhotos recentPhotos;
    private FileExport historyExport;
    private AutoBackup autoBackup;
    private ImageSave imageSave;
    private NativeRecorder recorder;
    private final CallAudioCapture callCapture = new CallAudioCapture();
    private AppUpdater updater;
    private boolean backPreviewEnabled;
    /** 主文档加载失败仅自动重试一次，避免资源缺失时无限重载 */
    private boolean mainFrameRetried;
    private final InAppBackCallback inAppBack = new InAppBackCallback(this, this::handleBack,
        this::reportBackPreview);
    private final ExecutorService photoExecutor = Executors.newSingleThreadExecutor();
    private AccessibilityManager accessibility;
    private final AccessibilityManager.AccessibilityStateChangeListener accessibilityState =
        enabled -> {
            if (enabled) primeAccessibility();
        };

    @Override
/* -------------------- 功能区：生命周期与 WebView 初始化 开始 -------------------- */
    public void onCreate(Bundle state) {
        super.onCreate(state);
        keys = new ApiKeyStore(this);
        chatConfig = new ApiKeyStore(this, "custom-chat");
        profilePreferences = getSharedPreferences("account_profile", MODE_PRIVATE);
        recentPhotos = new RecentPhotos(getContentResolver());
        historyExport = new FileExport(getContentResolver());
        autoBackup = new AutoBackup(getContentResolver(), getCacheDir());
        imageSave = new ImageSave(getContentResolver());
        recorder = new NativeRecorder();
        frame = new FrameLayout(this);
        SystemBars.applyInsets(getWindow(), frame, (safe, ime, buttonNavigationBottom) -> {
            // Let WebView paint behind the navigation buttons while CSS insets the controls.
            int webBottom = ime ? 0 : buttonNavigationBottom;
            frame.setPadding(safe.left, 0, safe.right, safe.bottom - webBottom);
            float density = getResources().getDisplayMetrics().density;
            float top = safe.top / density;
            float bottom = webBottom / density;
            if (top != statusInset || bottom != buttonNavigationInset || ime != keyboardVisible) {
                statusInset = top;
                buttonNavigationInset = bottom;
                keyboardVisible = ime;
                if (webView == null) return;
                webView.evaluateJavascript("if (document.documentElement) { const root = document.documentElement;"
                    + "root.style.setProperty('--android-status-inset', '" + top + "px');"
                    + "root.style.setProperty('--android-button-nav-inset', '" + bottom + "px');"
                    + "root.toggleAttribute('data-button-navigation', " + (bottom > 0) + ");"
                    + "root.toggleAttribute('data-keyboard', " + ime + "); }", null);
            }
        });
        setContentView(frame);
        accessibility = getSystemService(AccessibilityManager.class);
        if (accessibility != null) {
            accessibility.addAccessibilityStateChangeListener(accessibilityState);
        }
        WebView.setWebContentsDebuggingEnabled(
            (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        updater = new AppUpdater(this, status -> {
            if (webView != null) {
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-update', {detail: "
                    + status + "}))", null);
            }
        });
        // 顺序约束：先创建 WebView，再应用系统栏配色。
        // setBars 会调用 webView.setBackgroundColor，若在视图创建之前执行将触发空指针，启动即退出。
        installWebView();
        setBars((getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES);
    }

    /**
     * 创建并配置承载界面的 WebView。
     * 渲染进程被系统回收或 WebView 自身升级后需重建，该实现由启动流程与恢复流程共用。
     */
    private void installWebView() {
        webView = new WebView(this);
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 界面资源全部来自 APK 内的 assets，不存在需缓存的远端资源。
        // 关闭 HTTP 缓存，覆盖安装后不会再读取上一版本的 index 与主包。
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // 升级后旧 WebView 缓存可能仍指向上一版本的 index 与主包哈希，表现为白屏。
        // 仅在版本号变化时清理一次缓存，日常启动不受影响，且不触及 localStorage 与 IndexedDB。
        clearAssetCacheOnUpgrade(webView);
        webView.setWebViewClient(new AppPage());
        webView.setWebChromeClient(new DeviceFeatures());
        webView.addJavascriptInterface(new DeviceBridge(), "DeepSeekAndroid");
        webView.loadUrl(HOME);
    }

    /**
     * 渲染进程失效（内存回收、WebView 后台升级）时，默认实现会终止整个应用进程，
     * 表现为白屏或闪退。此处销毁旧视图、重建并重新加载，本机数据不受影响。
     */
    private void recoverRenderProcess() {
        WebView crashed = webView;
        webView = null;
        if (crashed != null) {
            frame.removeView(crashed);
            crashed.destroy();
        }
        mainFrameRetried = false;
        installWebView();
        setBars((getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES);
    }

    /** 版本变化时清理 WebView 缓存，避免旧 index.html 指向已被替换的 main.<hash>.js */
    private void clearAssetCacheOnUpgrade(WebView view) {
        try {
            String version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            android.content.SharedPreferences prefs =
                getSharedPreferences("asset_cache", MODE_PRIVATE);
            if (version != null && !version.equals(prefs.getString("version", null))) {
                view.clearCache(true);
                view.clearFormData();
                view.clearHistory();
                prefs.edit().putString("version", version).apply();
            }
        } catch (Exception ignored) {
            // 版本号读取失败不影响启动：资源拦截仍携带 no-store 响应头
        }
    }

    private void primeAccessibility() {
        if (webView == null) return;
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        AccessibilityNodeInfo host = webView.createAccessibilityNodeInfo();
        if (host != null) host.recycle();
    }

    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation") // Legacy back still needs to ask the WebView first.
/* -------------------- 功能区：生命周期与 WebView 初始化 结束 -------------------- */

/* -------------------- 功能区：返回键与系统栏 开始 -------------------- */
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript("window.dispatchEvent(new Event('android-back', {cancelable: true}))",
            result -> { if ("true".equals(result)) finish(); });
    }

    private void reportBackPreview(InAppBackCallback.Preview event) {
        if (!backPreviewEnabled || webView == null) return;
        String detail = "null";
        if (event != null) {
            float density = getResources().getDisplayMetrics().density;
            String edge = event.edge() == null ? "null" : "'" + event.edge() + "'";
            detail = "{progress: " + event.progress() + ", edge: " + edge
                + ", touchY: " + (event.touchY() / density) + "}";
        }
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-back-preview', {detail: "
            + detail + "}))", null);
    }

    private void setBars(boolean dark) {
        SystemBars.setAppearance(getWindow(), dark);
        int color = Color.parseColor(dark ? "#151517" : "#FFFFFF");
        frame.setBackgroundColor(color);
        if (webView != null) {
            webView.setBackgroundColor(color);
        }
    }

/* -------------------- 功能区：返回键与系统栏 结束 -------------------- */

/* -------------------- 功能区：WebViewClient、资源拦截与文件选择 开始 -------------------- */
    private static boolean isBundled(Uri url) {
        return "https".equals(url.getScheme()) && ASSET_HOST.equals(url.getHost())
            && url.getPort() == -1;
    }

    private final class AppPage extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            backPreviewEnabled = false;
            inAppBack.setEnabled(false);
        }

        /** 渲染进程被回收或 WebView 升级：重建视图并重新加载，避免停留在白屏 */
        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            if (view != webView) {
                return true;
            }
            recoverRenderProcess();
            return true;
        }

        /** 主文档加载失败时重试一次；仍失败则将原因交由页面内启动提示处理 */
        @Override
        public void onReceivedError(WebView view, WebResourceRequest request,
            android.webkit.WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame() || view != webView || mainFrameRetried) {
                return;
            }
            mainFrameRetried = true;
            view.postDelayed(() -> {
                if (webView == view) {
                    view.loadUrl(HOME);
                }
            }, 400);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            mainFrameRetried = false;
            if (accessibility != null && accessibility.isEnabled()) {
                primeAccessibility();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (isBundled(request.getUrl())) {
                return !request.isForMainFrame() || !"/index.html".equals(request.getUrl().getPath());
            }
            String scheme = request.getUrl().getScheme();
            if (request.isForMainFrame() && ("https".equals(scheme) || "http".equals(scheme))) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (ActivityNotFoundException ignored) {
                    // The device has no browser for external links.
                }
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!isBundled(url)) return null;
            String path = url.getPath();
            if ("/recording.wav".equals(path)) {
                WebResourceResponse audio = recorder.takeWav();
                if (audio != null) return audio;
            }
            if (path != null && path.matches("/(recent|thumbnail)/[0-9]+")) {
                WebResourceResponse photo = recentPhotos.open(url.getLastPathSegment(),
                    path.startsWith("/thumbnail/"));
                if (photo != null) return photo;
            }
            if ("/index.html".equals(path) || (path != null && path.startsWith("/static/")
                    && !path.contains("/../"))) {
                String name = path.substring(1);
                String extension = name.substring(name.lastIndexOf('.') + 1);
                String type = "js".equals(extension) ? "text/javascript"
                    : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                Map<String, String> headers = Map.of(
                    "Content-Security-Policy",
                    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                    + "img-src 'self' https: data: blob:; font-src 'self' data:; "
                    + "media-src 'self' blob:; connect-src 'self' https://api.deepseek.com; "
                    + "frame-src 'none'; base-uri 'none'; form-action 'none';",
                    // 本地资源禁止缓存：APK 升级后路径不变而文件名变化，使用缓存文件将导致白屏
                    "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0",
                    "Pragma", "no-cache",
                    "Expires", "0");
                try {
                    return new WebResourceResponse(type == null ? "application/octet-stream" : type,
                        "UTF-8", 200, "OK", headers, getAssets().open(name));
                } catch (IOException ignored) {
                    // Unknown paths must stay inside the bundled origin.
                }
            }
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Map.of(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private final class DeviceFeatures extends WebChromeClient {
        /**
         * WebView 默认拒绝页面的录音请求，即使系统已授予权限仍返回「未授权麦克风」。
         * 此处仅放行音频采集；系统权限未授予时先发起申请，结果在 onRequestPermissionsResult 里补 grant。
         */
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean audio = false;
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                    audio = true;
                    break;
                }
            }
            if (!audio) {
                request.deny();
                return;
            }
            if (granted(Manifest.permission.RECORD_AUDIO)) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                return;
            }
            pendingAudioRequest = request;
            requestPermissions(new String[]{
                Manifest.permission.MODIFY_AUDIO_SETTINGS,
                Manifest.permission.RECORD_AUDIO
            }, MICROPHONE_WEB);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            choosingPhotos = false;
            if (params.isCaptureEnabled()) {
                if (granted(Manifest.permission.CAMERA)) {
                    launchCamera();
                } else {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA);
                }
                return true;
            }
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            String[] mimeTypes = Arrays.stream(params.getAcceptTypes())
                .map(type -> type.startsWith(".")
                    ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.substring(1)) : type)
                .filter(type -> type != null && type.contains("/"))
                .distinct().toArray(String[]::new);
            intent.setType(mimeTypes.length == 1 ? mimeTypes[0] : "*/*");
            if (mimeTypes.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
            choosingPhotos = Arrays.equals(mimeTypes, new String[]{"image/*"});
            if (Build.VERSION.SDK_INT >= 33 && choosingPhotos) {
                Intent picker = new Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*");
                if (multiple) {
                    picker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 10);
                }
                try {
                    startActivityForResult(picker, FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException ignored) {
                    // Use the document picker on devices without the system photo picker.
                }
            }
            try {
                startActivityForResult(intent, FILE_CHOOSER);
            } catch (ActivityNotFoundException ignored) {
                fileCallback = null;
                callback.onReceiveValue(null);
            }
            return true;
        }
    }

/* -------------------- 功能区：WebViewClient、资源拦截与文件选择 结束 -------------------- */

/* -------------------- 功能区：运行时权限与媒体入口 开始 -------------------- */
    private boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasRecentPhotosPermission() {
        String imagesPermission = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        return granted(imagesPermission) || (Build.VERSION.SDK_INT >= 34
            && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED));
    }

    private void showRecentPhotos() {
        String imagesPermission = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (!hasRecentPhotosPermission() && !askedForPhotos) {
            askedForPhotos = true;
            String[] permissions = Build.VERSION.SDK_INT >= 34
                ? new String[]{imagesPermission, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED}
                : new String[]{imagesPermission};
            requestPermissions(permissions, PHOTOS);
        } else {
            notifyRecentPhotos();
        }
    }

    private void notifyRecentPhotos() {
        photoExecutor.execute(() -> {
            String photos = recentPhotos.list();
            runOnUiThread(() -> {
                if (!isFinishing() && !isDestroyed()) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-photos', "
                        + "{detail: " + photos + "}))", null);
                }
            });
        });
    }

    private void launchCamera() {
        try {
            capture = CaptureProvider.create(this);
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, capture)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            camera.setClipData(ClipData.newRawUri("photo", capture));
            startActivityForResult(camera, FILE_CHOOSER);
        } catch (IOException | ActivityNotFoundException ignored) {
            capture = null;
            completeFileChooser(null);
        }
    }

    private void completeFileChooser(Uri[] files) {
        if (fileCallback == null) return;
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        callback.onReceiveValue(files);
    }

    private void completePhotoChooser(Uri[] files) {
        ValueCallback<Uri[]> callback = fileCallback;
        photoExecutor.execute(() -> {
            for (int index = 0; index < files.length; index++) {
                Uri uri = files[index];
                try {
                    if (!SelectedPhoto.isHeif(getContentResolver().getType(uri))) continue;
                    Uri decoded = CaptureProvider.createPng(this);
                    try (OutputStream output = getContentResolver().openOutputStream(decoded)) {
                        if (output == null) continue;
                        SelectedPhoto.writePng(getContentResolver(), uri, output);
                    }
                    files[index] = decoded;
                } catch (IOException | SecurityException ignored) {
                    // The original document can still be handled by normal attachment validation.
                }
            }
            runOnUiThread(() -> {
                if (!isDestroyed() && fileCallback == callback) completeFileChooser(files);
            });
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MICROPHONE) {
            startRecording();
        } else if (code == MICROPHONE_CALL) {
            notifyMicrophone(granted(Manifest.permission.RECORD_AUDIO));
        } else if (code == MICROPHONE_WEB) {
            PermissionRequest request = pendingAudioRequest;
            pendingAudioRequest = null;
            if (request == null) {
                return;
            }
            if (granted(Manifest.permission.RECORD_AUDIO)) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                request.deny();
            }
            notifyMicrophone(granted(Manifest.permission.RECORD_AUDIO));
        } else if (code == PHOTOS) {
            notifyRecentPhotos();
        } else if (code == CAMERA && fileCallback != null) {
            if (granted(Manifest.permission.CAMERA)) {
                launchCamera();
            } else {
                completeFileChooser(null);
            }
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == AppUpdater.INSTALL_SOURCE_SETTINGS) {
            updater.permissionResult();
        } else if (code == EXPORT_HISTORY) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            reportExport(uri == null ? "cancelled" : historyExport.open(uri) ? "ready" : "error");
        } else if (code == FILE_CHOOSER && fileCallback != null) {
            Uri[] files = null;
            if (result == RESULT_OK) {
                if (capture != null) {
                    files = new Uri[]{capture};
                } else if (data != null && data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    files = new Uri[clip.getItemCount()];
                    for (int index = 0; index < files.length; index++) {
                        files[index] = clip.getItemAt(index).getUri();
                    }
                } else if (data != null && data.getData() != null) {
                    files = new Uri[]{data.getData()};
                }
            }
            capture = null;
            if (choosingPhotos && files != null) {
                completePhotoChooser(files);
            } else {
                completeFileChooser(files);
            }
        }
    }

    @Override
/* -------------------- 功能区：运行时权限与媒体入口 结束 -------------------- */

/* -------------------- 功能区：前后台生命周期与导出收尾 开始 -------------------- */
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (frame != null) {
            frame.requestApplyInsets();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        updater.resume();
    }

    @Override
    protected void onPause() {
        // 退到后台前让页面检查一次自动备份窗口，冻结后不会再有机会写盘
        if (webView != null) {
            webView.evaluateJavascript(
                "window.__replicaLifecyclePause && window.__replicaLifecyclePause()", null);
        }
        updater.pause();
        super.onPause();
    }

    @Override
    protected void onStop() {
        recorder.finish(false);
        // 通话中的系统直录必须在后台入口同步释放，否则再次进入时 AudioRecord 仍被旧会话占着
        callCapture.stop();
        webView.evaluateJavascript("window.dispatchEvent(new Event('android-recording-interrupted'))", null);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        customChat.close();
        inAppBack.setEnabled(false);
        if (accessibility != null) {
            accessibility.removeAccessibilityStateChangeListener(accessibilityState);
        }
        photoExecutor.shutdownNow();
        updater.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        recorder.finish(false);
        callCapture.stop();
        historyExport.close();
        imageSave.finish(false);
        if (webView != null) {
            frame.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void reportExport(String state) {
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-export', "
            + "{detail: '" + state + "'}))", null);
    }

    /** 把录音授权结果回传前端，通话入口据此决定是否进入 */
    private void notifyMicrophone(boolean granted) {
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-microphone', "
            + "{detail: '" + (granted ? "granted" : "denied") + "'}))", null);
    }

    private void startRecording() {
        String state = !granted(Manifest.permission.RECORD_AUDIO) ? "denied"
            : recorder.start() ? "ready" : "error";
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-recording', "
            + "{detail: '" + state + "'}))", null);
    }

    private final class DeviceBridge {
        /** 通话开始：申请语音通信音频焦点，来电或其他应用播放时由系统处理 */
        @JavascriptInterface
        public boolean requestCallAudioFocus() {
            runOnUiThread(() -> {
                AudioManager audio = getSystemService(AudioManager.class);
                if (audio == null) return;
                if (callFocus == null) {
                    AudioAttributes attributes = new AudioAttributes.Builder()
                        // 角色声音由 WebView 的 AudioContext 播放，走媒体用途才会从扬声器出来；
                        // 用 USAGE_VOICE_COMMUNICATION 会被部分 ROM 路由到听筒，听起来像没声音。
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                    callFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(attributes)
                        .setOnAudioFocusChangeListener(change -> { })
                        .build();
                }
                audio.requestAudioFocus(callFocus);
            });
            return true;
        }

        /** 挂断或切至后台：释放音频焦点 */
        @JavascriptInterface
        public void abandonCallAudioFocus() {
            runOnUiThread(() -> {
                AudioManager audio = getSystemService(AudioManager.class);
                if (audio != null && callFocus != null) {
                    audio.abandonAudioFocusRequest(callFocus);
                }
            });
        }

        @JavascriptInterface
/* -------------------- 功能区：前后台生命周期与导出收尾 结束 -------------------- */

/* -------------------- 功能区：JavaScript 桥与设置接口 开始 -------------------- */
        public float statusInset() { return statusInset; }

        @JavascriptInterface
        public float buttonNavigationInset() { return buttonNavigationInset; }

        @JavascriptInterface
        public float systemFontScale() { return getResources().getConfiguration().fontScale; }

        @JavascriptInterface
        public int getMusicVolume() {
            AudioManager audio = getSystemService(AudioManager.class);
            return audio == null ? -1 : audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        }

        @JavascriptInterface
        public void openAppPermissions() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getPackageName(), null))));
        }

        @JavascriptInterface
        public String updateStatus() { return updater.status(); }

        @JavascriptInterface
        public void checkForUpdate() { runOnUiThread(() -> updater.check()); }

        @JavascriptInterface
        public void installUpdate() { runOnUiThread(() -> updater.update()); }

        @JavascriptInterface
        public void openSourcePage(String url, boolean dark, String closeLabel, String browserLabel,
                                   String loadingLabel, String errorLabel, String retryLabel) {
            Uri uri = SourceBrowserActivity.webUri(url);
            if (uri == null) return;
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, SourceBrowserActivity.class)
                .setData(uri).putExtra("dark", dark)
                .putExtra("closeLabel", closeLabel).putExtra("browserLabel", browserLabel)
                .putExtra("loadingLabel", loadingLabel).putExtra("errorLabel", errorLabel)
                .putExtra("retryLabel", retryLabel)));
        }

        @JavascriptInterface
        public String readApiKey() { return keys.read(); }

        @JavascriptInterface
        public boolean writeApiKey(String value) { return keys.write(value); }

        @JavascriptInterface
        public String readChatConfig() { return chatConfig.read(); }

        @JavascriptInterface
        public boolean writeChatConfig(String value) { return chatConfig.write(value); }

        @JavascriptInterface
        public String beginChatRequest(String endpoint, String format, String body, String headers) {
            return customChat.begin(chatConfig.read(), endpoint, format, body, headers, payload ->
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('android-custom-chat',{detail:"
                        + payload + "}))", null);
                }));
        }

        @JavascriptInterface
        public void cancelChatRequest(String id) { if (id != null) customChat.cancel(id); }

        @JavascriptInterface
        public String readAccountProfile() { return profilePreferences.getString(PROFILE_KEY, null); }

        @JavascriptInterface
        public boolean writeAccountProfile(String value) {
            SharedPreferences.Editor editor = profilePreferences.edit();
            if (value == null) editor.remove(PROFILE_KEY);
            else editor.putString(PROFILE_KEY, value);
            return editor.commit();
        }

        @JavascriptInterface
        public void setDarkBars(boolean dark) { runOnUiThread(() -> setBars(dark)); }

        @JavascriptInterface
        public void setHandlesBack(boolean handlesBack) {
            runOnUiThread(() -> { if (!isDestroyed()) inAppBack.setEnabled(handlesBack); });
        }

        @JavascriptInterface
        public void setBackPreviewEnabled(boolean enabled) {
            runOnUiThread(() -> { if (!isDestroyed()) backPreviewEnabled = enabled; });
        }

        @JavascriptInterface
        public void setImageViewerFullscreen(boolean fullscreen) {
            runOnUiThread(() -> SystemBars.setFullscreen(getWindow(), fullscreen));
        }

        @JavascriptInterface
        public void requestRecentPhotos() { runOnUiThread(() -> showRecentPhotos()); }

        @JavascriptInterface
        public void prefetchRecentPhotos() {
            runOnUiThread(() -> { if (hasRecentPhotosPermission()) notifyRecentPhotos(); });
        }

        @JavascriptInterface
        public String deviceStats() {
            try {
                ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
                manager.getMemoryInfo(memory);
                long cacheBytes = directorySize(getCacheDir());
                File externalCache = getExternalCacheDir();
                if (externalCache != null) {
                    cacheBytes += directorySize(externalCache);
                }
                long filesBytes = directorySize(getFilesDir()) + directorySize(new File(getDataDir(), "databases"));
                long webviewBytes = directorySize(new File(getDataDir(), "app_webview"));
                StatFs data = new StatFs(getDataDir().getAbsolutePath());
                long freeBytes = data.getAvailableBytes();
                long totalBytes = data.getTotalBytes();
                JSONObject json = new JSONObject();
                json.put("totalMem", memory.totalMem);
                json.put("availMem", memory.availMem);
                json.put("lowMemory", memory.lowMemory);
                json.put("threshold", memory.threshold);
                json.put("cacheBytes", cacheBytes);
                json.put("dataBytes", filesBytes);
                json.put("webviewBytes", webviewBytes);
                json.put("storageFree", freeBytes);
                json.put("storageTotal", totalBytes);
                json.put("heapUsed", Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
                json.put("heapMax", Runtime.getRuntime().maxMemory());
                return json.toString();
            } catch (Exception error) {
                return "{\"error\":\"" + error.getClass().getSimpleName() + "\"}";
            }
        }

        private long directorySize(File dir) {
            if (dir == null || !dir.exists()) {
                return 0;
            }
            if (dir.isFile()) {
                return dir.length();
            }
            long size = 0;
            File[] children = dir.listFiles();
            if (children == null) {
                return 0;
            }
            for (File child : children) {
                size += directorySize(child);
            }
            return size;
        }

        @JavascriptInterface
        public void requestHistoryExport(String fileName) {
            runOnUiThread(() -> {
                String lower = fileName.toLowerCase();
                String mime = "application/zip";
                if (lower.endsWith(".txt")) {
                    mime = "text/plain";
                } else if (lower.endsWith(".md")) {
                    mime = "text/markdown";
                } else if (lower.endsWith(".json")) {
                    mime = "application/json";
                }
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime)
                    .putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(intent, EXPORT_HISTORY);
                } catch (ActivityNotFoundException ignored) {
                    reportExport("error");
                }
            });
        }

        @JavascriptInterface
        public boolean writeHistoryExport(String bytes) { return historyExport.append(bytes); }

        @JavascriptInterface
        public boolean finishHistoryExport() { return historyExport.close(); }

        @JavascriptInterface
        public String beginAutoBackup(String name, long size) { return autoBackup.begin(name, size); }

        @JavascriptInterface
        public boolean writeAutoBackup(String bytes) { return autoBackup.append(bytes); }

        @JavascriptInterface
        public boolean finishAutoBackup() { return autoBackup.finish(); }

        @JavascriptInterface
        public String autoBackupStatus() { return autoBackup.status(); }

        @JavascriptInterface
        public String autoBackupError() { return autoBackup.error(); }

        @JavascriptInterface
        public void pruneAutoBackups(int keep) { autoBackup.prune(keep); }

        @JavascriptInterface
        public boolean beginImageSave(String name, String mime) { return imageSave.begin(name, mime); }

        @JavascriptInterface
        public boolean writeImageSave(String bytes) { return imageSave.append(bytes); }

        @JavascriptInterface
        public boolean finishImageSave(boolean keep) { return imageSave.finish(keep); }

        /** 通话入口先调用：已授权直接返回 granted，否则弹出系统授权框 */
/* -------------------- 功能区：JavaScript 桥与设置接口 结束 -------------------- */

/* -------------------- 功能区：录音、通话采集与选择手势 开始 -------------------- */
        @JavascriptInterface
        public void requestMicrophone() {
            runOnUiThread(() -> {
                if (granted(Manifest.permission.RECORD_AUDIO)) {
                    notifyMicrophone(true);
                } else {
                    requestPermissions(
                        new String[]{
                            Manifest.permission.MODIFY_AUDIO_SETTINGS,
                            Manifest.permission.RECORD_AUDIO
                        }, MICROPHONE_CALL);
                }
            });
        }

        @JavascriptInterface
        public void requestRecording() {
            runOnUiThread(() -> {
                if (granted(Manifest.permission.RECORD_AUDIO)) {
                    startRecording();
                } else {
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE);
                }
            });
        }

        @JavascriptInterface
        public boolean finishRecording(boolean keep) { return recorder.finish(keep); }

        /** 通话前调用：放掉语音输入那条路持有的 AudioRecord，避免 WebView 采集报通道被占用 */
        @JavascriptInterface
        public boolean releaseNativeRecorder() { return recorder.finish(false); }

        /**
         * 采集前把音频子系统交还给 WebView：结束原生录音、退出通话模式、放弃音频焦点。
         * 部分 ROM（vivo / iQOO 等）在 MODE_IN_CALL 或持有音频焦点时只允许原生层录音，
         * WebView 的 getUserMedia 会直接抛 NotReadableError，因此关闭这几个前置条件。
         */
        @JavascriptInterface
        public boolean prepareMicrophone() {
            // AudioRecord 可以在注入桥线程上安全停止；AudioManager 的模式与焦点必须回主线程，
            // 否则部分 ROM 会直接抛 IllegalStateException，清理没生效还会继续报通道被占用。
            boolean released = recorder.finish(false);
            final CountDownLatch done = new CountDownLatch(1);
            runOnUiThread(() -> {
                try {
                    AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                    if (am != null) {
                        if (am.getMode() != AudioManager.MODE_NORMAL) {
                            am.setMode(AudioManager.MODE_NORMAL);
                        }
                        if (callFocus != null) {
                            am.abandonAudioFocusRequest(callFocus);
                            callFocus = null;
                        }
                        am.stopBluetoothSco();
                    }
                } catch (Throwable ignored) {
                    // 个别 ROM 上这些调用本身会抛，清不掉就按原状态继续尝试采集
                } finally {
                    done.countDown();
                }
            });
            try {
                // 最多等半秒；超时也继续申请，避免把 UI 线程和注入桥互相卡死。
                done.await(500, TimeUnit.MILLISECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return released;
        }

        /** WebView 采集前先拿住音频焦点；部分 ROM 只有持有焦点时才允许页面开麦 */
        @JavascriptInterface
        public boolean ensureCallAudioFocus() {
            final boolean[] granted = {false};
            final CountDownLatch done = new CountDownLatch(1);
            runOnUiThread(() -> {
                try {
                    AudioManager audio = getSystemService(AudioManager.class);
                    if (audio != null) {
                        if (callFocus == null) {
                            AudioAttributes attributes = new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build();
                            callFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                                .setAudioAttributes(attributes)
                                .setOnAudioFocusChangeListener(change -> { })
                                .build();
                        }
                        granted[0] = audio.requestAudioFocus(callFocus)
                            == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
                    }
                } catch (Throwable ignored) {
                    // 焦点申请失败时继续尝试 WebView 采集，后续仍有系统直录兜底
                } finally {
                    done.countDown();
                }
            });
            try {
                done.await(350, TimeUnit.MILLISECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return granted[0];
        }

        /** WebView 采集被 ROM 拦截时启动系统直录，JS 通过 readCallCapture 轮询 PCM */
        @JavascriptInterface
        public boolean startCallCapture() {
            // 语音输入的原生录音若仍持有麦克风，通话采集会立刻拿到空数据或初始化失败。
            recorder.finish(false);
            return callCapture.start();
        }

        @JavascriptInterface
        public String readCallCapture() { return callCapture.read(); }

        /** 采集线程状态与最近错误，页面用于区分暂时无数据和通道已退出 */
        @JavascriptInterface
        public String callCaptureStatus() { return callCapture.status(); }

        @JavascriptInterface
        public void stopCallCapture() { callCapture.stop(); }

        /**
         * 麦克风自检：真正开一次 AudioRecord 再放掉，用来区分「系统录音通道被占」和
         * 「WebView 采集被内核拦下」。返回 JSON：perm / ok / stage / error / read / mode。
         * 只读一块 512 采样，不落盘、不留设备。
         */
        @JavascriptInterface
        public String probeMicrophone() {
            {
                org.json.JSONObject result = new org.json.JSONObject();
                boolean perm = granted(Manifest.permission.RECORD_AUDIO);
                AudioRecord record = null;
                String stage = "init";
                String error = "";
                int read = 0;
                try {
                    result.put("perm", perm);
                    recorder.finish(false);
                    int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT);
                    if (min <= 0) {
                        stage = "buffer";
                        throw new IllegalStateException("getMinBufferSize=" + min);
                    }
                    record = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                        Math.max(min * 2, 4096));
                    if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                        stage = "state";
                        throw new IllegalStateException("state=" + record.getState());
                    }
                    stage = "start";
                    record.startRecording();
                    if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                        stage = "recording";
                        throw new IllegalStateException("recordingState=" + record.getRecordingState());
                    }
                    stage = "read";
                    short[] buffer = new short[512];
                    read = record.read(buffer, 0, buffer.length);
                    if (read <= 0) {
                        throw new IllegalStateException("read=" + read);
                    }
                    stage = "ok";
                } catch (Exception failure) {
                    error = failure.getClass().getSimpleName()
                        + (failure.getMessage() == null ? "" : ": " + failure.getMessage());
                } finally {
                    if (record != null) {
                        try { record.stop(); } catch (IllegalStateException ignored) { }
                        record.release();
                    }
                }
                try {
                    result.put("ok", "ok".equals(stage));
                    result.put("stage", stage);
                    result.put("error", error);
                    result.put("read", read);
                    AudioManager audio = getSystemService(AudioManager.class);
                    result.put("mode", audio == null ? -1 : audio.getMode());
                    result.put("sdk", Build.VERSION.SDK_INT);
                } catch (org.json.JSONException ignored) { }
                return result.toString();
            }
        }

        @JavascriptInterface
        public double recordingLevel() { return recorder.level(); }

        @JavascriptInterface
        public void setSelectionExclusion(
            float startLeft,
            float startTop,
            float startRight,
            float startBottom,
            float endLeft,
            float endTop,
            float endRight,
            float endBottom,
            boolean active
        ) {
            runOnUiThread(() -> {
                if (webView == null) return;
                if (!active) {
                    webView.setSystemGestureExclusionRects(Collections.emptyList());
                    return;
                }
                float density = getResources().getDisplayMetrics().density;
                List<Rect> rects = new ArrayList<>(2);
                int w = webView.getWidth();
                int h = webView.getHeight();
                if (startRight > startLeft && startBottom > startTop) {
                    rects.add(new Rect(
                        Math.max(0, Math.round(startLeft * density)),
                        Math.max(0, Math.round(startTop * density)),
                        Math.min(w, Math.round(startRight * density)),
                        Math.min(h, Math.round(startBottom * density))
                    ));
                }
                if (endRight > endLeft && endBottom > endTop) {
                    rects.add(new Rect(
                        Math.max(0, Math.round(endLeft * density)),
                        Math.max(0, Math.round(endTop * density)),
                        Math.min(w, Math.round(endRight * density)),
                        Math.min(h, Math.round(endBottom * density))
                    ));
                }
                webView.setSystemGestureExclusionRects(rects);
            });
        }
    }
}
/* -------------------- 功能区：录音、通话采集与选择手势 结束 -------------------- */

/* ============================================================================
 * 功能区：Android 原生容器 / MainActivity 结束
 * ========================================================================== */
