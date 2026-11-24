/* ============================================================================
 * 功能区：Android 原生容器 / InAppBackCallback 开始
 * 职责：InAppBackCallback 原生实现，负责该类的平台能力，并通过 JS 桥或 Intent 与页面交互。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

import android.app.Activity;
import android.os.Build;
import android.window.BackEvent;
import android.window.OnBackAnimationCallback;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.util.function.Consumer;

/** Lets the system preview its own navigation when there is no in-app back action. */
final class InAppBackCallback {
    record Preview(float progress, String edge, float touchY) {}

    private final Activity activity;
    private final Runnable action;
    private final Consumer<Preview> onPreview;
    private OnBackInvokedCallback callback;

    InAppBackCallback(Activity activity, Runnable action) {
        this(activity, action, null);
    }

    InAppBackCallback(Activity activity, Runnable action, Consumer<Preview> onPreview) {
        this.activity = activity;
        this.action = action;
        this.onPreview = onPreview;
    }

    void setEnabled(boolean enabled) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || enabled == (callback != null)) {
            return;
        }
        OnBackInvokedDispatcher dispatcher = activity.getOnBackInvokedDispatcher();
        if (enabled) {
            callback = createCallback();
            dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
        } else {
            dispatcher.unregisterOnBackInvokedCallback(callback);
            callback = null;
        }
    }

    private OnBackInvokedCallback createCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && onPreview != null) {
            return new OnBackAnimationCallback() {
                @Override public void onBackStarted(BackEvent event) { onBackProgressed(event); }

                @Override public void onBackProgressed(BackEvent event) {
                    String edge = switch (event.getSwipeEdge()) {
                        case BackEvent.EDGE_LEFT -> "left";
                        case BackEvent.EDGE_RIGHT -> "right";
                        default -> null;
                    };
                    onPreview.accept(new Preview(event.getProgress(), edge, event.getTouchY()));
                }

                @Override public void onBackCancelled() { onPreview.accept(null); }
                @Override public void onBackInvoked() { action.run(); }
            };
        }
        return action::run;
    }
}


/* ============================================================================
 * 功能区：Android 原生容器 / InAppBackCallback 结束
 * ========================================================================== */
