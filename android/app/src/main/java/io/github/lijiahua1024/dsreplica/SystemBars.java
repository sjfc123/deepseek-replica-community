/* ============================================================================
 * 功能区：Android 原生容器 / SystemBars 开始
 * 职责：Android 系统栏：状态栏/导航栏配色与 Insets 计算。
 * ========================================================================== */

package io.github.lijiahua1024.dsreplica;

import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

final class SystemBars {
    interface InsetsListener {
        void update(Insets safe, boolean keyboardVisible, int buttonNavigationBottom);
    }

    @SuppressWarnings("deprecation") // Android 10-14 require explicit edge-to-edge and transparent bars.
    static void applyInsets(Window window, View content, InsetsListener listener) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
        window.setStatusBarContrastEnforced(false);
        window.setNavigationBarContrastEnforced(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                window.setDecorFitsSystemWindows(false);
            }
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                int buttonNavigationBottom = insets.getInsets(WindowInsets.Type.tappableElement()).bottom > 0
                    ? insets.getInsets(WindowInsets.Type.navigationBars()).bottom : 0;
                listener.update(safe, insets.isVisible(WindowInsets.Type.ime()), buttonNavigationBottom);
                return WindowInsets.CONSUMED;
            });
            return;
        }

        View decor = window.getDecorView();
        decor.setSystemUiVisibility(decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets safe = insets.getSystemWindowInsets();
            WindowInsets rootInsets = view.getRootWindowInsets();
            int navigation = rootInsets == null ? insets.getStableInsetBottom()
                : rootInsets.getStableInsetBottom();
            boolean keyboardVisible = safe.bottom > navigation;
            DisplayCutout cutout = insets.getDisplayCutout();
            if (cutout != null) {
                safe = Insets.of(Math.max(safe.left, cutout.getSafeInsetLeft()),
                    Math.max(safe.top, cutout.getSafeInsetTop()),
                    Math.max(safe.right, cutout.getSafeInsetRight()),
                    Math.max(safe.bottom, cutout.getSafeInsetBottom()));
            }
            int buttonNavigationBottom = insets.getTappableElementInsets().bottom > 0
                ? Math.min(safe.bottom, navigation) : 0;
            listener.update(safe, keyboardVisible, buttonNavigationBottom);
            return insets.consumeSystemWindowInsets().consumeStableInsets().consumeDisplayCutout();
        });
    }

    @SuppressWarnings("deprecation") // Android 10 controls icon colors through system UI flags.
    static void setAppearance(Window window, boolean dark) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : flags, flags);
            }
        } else {
            View decor = window.getDecorView();
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            int visibility = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(dark ? visibility & ~flags : visibility | flags);
        }
        window.setStatusBarContrastEnforced(false);
        window.setNavigationBarContrastEnforced(false);
    }

    @SuppressWarnings("deprecation") // Android 10 uses immersive system UI flags.
    static void setFullscreen(Window window, boolean fullscreen) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            if (fullscreen) {
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            } else {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_DEFAULT);
                controller.show(WindowInsets.Type.systemBars());
            }
        } else {
            View decor = window.getDecorView();
            int flags = View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            int visibility = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(fullscreen ? visibility | flags : visibility & ~flags);
        }
    }

    private SystemBars() {}
}


/* ============================================================================
 * 功能区：Android 原生容器 / SystemBars 结束
 * ========================================================================== */
