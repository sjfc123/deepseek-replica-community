/* ============================================================================
 * 功能区：Android 原生容器 / SourceBrowserActivity 开始
 * 职责：Android 源码浏览页：本地 HTML/源码查看与返回处理。
 * ========================================================================== */

package io.github.sjfc123.deepsaga;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.webkit.WebBackForwardList;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** A separate WebView keeps external pages away from the application's JavaScript bridge. */
public final class SourceBrowserActivity extends Activity {
    private WebView page;
    private LinearLayout root;
    private final InAppBackCallback inAppBack = new InAppBackCallback(this, this::goBack);
    private FrameLayout content;
    private LinearLayout loading;
    private LinearLayout failure;
    private TextView failureMessage;
    private Uri initial;
    private Uri failedUrl;
    private boolean failed;

    static Uri webUri(String value) {
        if (value == null) return null;
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || host.isEmpty() || scheme == null
                || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) {
            return null;
        }
        return uri;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        initial = webUri(getIntent().getDataString());
        if (initial == null) {
            finish();
            return;
        }
        boolean dark = getIntent().getBooleanExtra("dark", false);
        int background = Color.parseColor(dark ? "#0F0F0F" : "#FFFFFF");
        int foreground = Color.parseColor(dark ? "#F8F8F8" : "#111111");

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(background);
        SystemBars.applyInsets(getWindow(), root, (safe, ime, buttonNavigationBottom) ->
            root.setPadding(safe.left, safe.top, safe.right, safe.bottom));
        FrameLayout toolbar = new FrameLayout(this);
        toolbar.setBackgroundColor(background);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(52)));

        TextView title = new TextView(this);
        title.setTextColor(foreground);
        title.setTextSize(16);
        title.setGravity(Gravity.CENTER);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        FrameLayout.LayoutParams titleLayout = new FrameLayout.LayoutParams(-1, -1);
        titleLayout.setMargins(dp(56), 0, dp(56), 0);
        toolbar.addView(title, titleLayout);

        ToolbarIcon close = new ToolbarIcon(this, false, foreground);
        close.setContentDescription(getIntent().getStringExtra("closeLabel"));
        close.setOnClickListener(view -> finish());
        toolbar.addView(close, new FrameLayout.LayoutParams(dp(48), -1, Gravity.START));

        String browserLabel = getIntent().getStringExtra("browserLabel");
        if (!TextUtils.isEmpty(browserLabel)) {
            ToolbarIcon external = new ToolbarIcon(this, true, foreground);
            external.setContentDescription(browserLabel);
            external.setOnClickListener(view -> {
                Uri current = webUri(page.getUrl());
                if (current == null) return;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, current));
                } catch (ActivityNotFoundException ignored) {
                    // No browser is available on this device.
                }
            });
            toolbar.addView(external, new FrameLayout.LayoutParams(dp(48), -1, Gravity.END));
        }
        View divider = new View(this);
        divider.setBackgroundColor(Color.parseColor(dark ? "#373737" : "#E5E5E5"));
        root.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));

        content = new FrameLayout(this);
        page = new WebView(this);
        page.setBackgroundColor(Color.WHITE);
        WebSettings settings = page.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        page.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onReceivedTitle(WebView view, String pageTitle) {
                title.setText(pageTitle);
            }
        });
        page.setWebViewClient(new WebViewClient() {
            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                inAppBack.setEnabled(view.canGoBack());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = webUri(request.getUrl().toString());
                if (target == null) return true;
                if (request.isForMainFrame()) showLoading();
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                showLoading();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!failed) {
                    view.postDelayed(() -> {
                        if (!failed) hideLoading();
                    }, 3000);
                }
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (!failed) hideLoading();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) showFailure(request.getUrl());
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    showFailure(request.getUrl());
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showFailure(Uri.parse(error.getUrl()));
            }
        });
        content.addView(page, new FrameLayout.LayoutParams(-1, -1));

        loading = new LinearLayout(this);
        loading.setOrientation(LinearLayout.VERTICAL);
        loading.setGravity(Gravity.CENTER);
        loading.setBackgroundColor(background);
        ProgressBar spinner = new ProgressBar(this);
        loading.addView(spinner, new LinearLayout.LayoutParams(dp(44), dp(44)));
        TextView loadingLabel = new TextView(this);
        loadingLabel.setText(getLabel("loadingLabel", "Loading..."));
        loadingLabel.setTextColor(Color.parseColor(dark ? "#B8B8B8" : "#666666"));
        loadingLabel.setTextSize(14);
        loadingLabel.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams loadingLabelLayout = new LinearLayout.LayoutParams(-2, -2);
        loadingLabelLayout.topMargin = dp(12);
        loading.addView(loadingLabel, loadingLabelLayout);
        content.addView(loading, new FrameLayout.LayoutParams(-1, -1));

        failure = new LinearLayout(this);
        failure.setOrientation(LinearLayout.VERTICAL);
        failure.setGravity(Gravity.CENTER);
        failure.setBackgroundColor(background);
        failure.setPadding(dp(32), dp(32), dp(32), dp(32));
        failure.setVisibility(View.GONE);
        failureMessage = new TextView(this);
        failureMessage.setTextColor(foreground);
        failureMessage.setTextSize(15);
        failureMessage.setGravity(Gravity.CENTER);
        failure.addView(failureMessage, new LinearLayout.LayoutParams(-1, -2));
        Button retry = new Button(this);
        retry.setText(getLabel("retryLabel", "Retry"));
        retry.setOnClickListener(view -> {
            Uri target = failedUrl != null ? failedUrl : initial;
            showLoading();
            page.loadUrl(target.toString());
        });
        LinearLayout.LayoutParams retryLayout = new LinearLayout.LayoutParams(-2, -2);
        retryLayout.topMargin = dp(20);
        failure.addView(retry, retryLayout);
        content.addView(failure, new FrameLayout.LayoutParams(-1, -1));

        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        SystemBars.setAppearance(getWindow(), dark);
        WebBackForwardList history = state == null ? null : page.restoreState(state);
        if (history == null) {
            showLoading();
            page.loadUrl(initial.toString());
        } else if (history.getCurrentItem() != null) {
            title.setText(history.getCurrentItem().getTitle());
            hideLoading();
        }
        inAppBack.setEnabled(page.canGoBack());
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        if (page != null) page.saveState(state);
        super.onSaveInstanceState(state);
    }

    private void goBack() {
        if (page != null && page.canGoBack()) page.goBack();
        else finish();
    }

    private String getLabel(String key, String defaultValue) {
        String value = getIntent().getStringExtra(key);
        return TextUtils.isEmpty(value) ? defaultValue : value;
    }

    private void showLoading() {
        if (loading == null) return;
        failed = false;
        page.setVisibility(View.VISIBLE);
        failure.setVisibility(View.GONE);
        loading.setVisibility(View.VISIBLE);
    }

    private void hideLoading() {
        if (loading == null) return;
        loading.setVisibility(View.GONE);
    }

    private void showFailure(Uri url) {
        if (failure == null) return;
        failed = true;
        failedUrl = webUri(url == null ? null : url.toString());
        failureMessage.setText(getLabel("errorLabel", "Unable to load this page. Please try again."));
        page.setVisibility(View.INVISIBLE);
        loading.setVisibility(View.GONE);
        failure.setVisibility(View.VISIBLE);
    }

    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation") // Legacy back still needs to check the page history.
    public void onBackPressed() {
        goBack();
    }

    @Override
    protected void onDestroy() {
        inAppBack.setEnabled(false);
        if (page != null) {
            root.removeView(page);
            page.destroy();
            page = null;
        }
        super.onDestroy();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class ToolbarIcon extends View {
        private final boolean external;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        ToolbarIcon(Context context, boolean external, int color) {
            super(context);
            this.external = external;
            paint.setColor(color);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.8f);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float density = getResources().getDisplayMetrics().density;
            canvas.save();
            canvas.translate(getWidth() / 2f + (external ? 2 : -2) * density, getHeight() / 2f);
            canvas.scale(density, density);
            if (external) {
                Path outline = new Path();
                outline.moveTo(-2, -7);
                outline.lineTo(-5, -7);
                outline.quadTo(-7, -7, -7, -5);
                outline.lineTo(-7, 5);
                outline.quadTo(-7, 7, -5, 7);
                outline.lineTo(5, 7);
                outline.quadTo(7, 7, 7, 5);
                outline.lineTo(7, 2);
                canvas.drawPath(outline, paint);
                canvas.drawLine(0, 0, 8, -8, paint);
                canvas.drawLine(2, -8, 8, -8, paint);
                canvas.drawLine(8, -8, 8, -2, paint);
            } else {
                canvas.drawLine(-6, -6, 6, 6, paint);
                canvas.drawLine(6, -6, -6, 6, paint);
            }
            canvas.restore();
        }
    }
}


/* ============================================================================
 * 功能区：Android 原生容器 / SourceBrowserActivity 结束
 * ========================================================================== */
