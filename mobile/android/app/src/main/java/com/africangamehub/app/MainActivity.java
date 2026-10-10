package com.africangamehub.app;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        keepPageClearOfSystemBars();
    }

    /**
     * The page is drawn between the status bar and the navigation bar, never under them, on
     * every version of Android and of the phone's web view. The bars themselves show the
     * window's own colour (the hub's indigo, see styles.xml).
     *
     * The site is written for browsers, where the browser keeps the top of the page clear. Here
     * the app does that job. When the keyboard opens, the page ends at the top of the keyboard,
     * so the field being typed in stays in view.
     *
     * (Capacitor's own handling is switched off in capacitor.config.ts, SystemBars.insetsHandling,
     * because it would draw the page under the bars on newer phones.)
     */
    private void keepPageClearOfSystemBars() {
        View window = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(window, (view, insets) -> {
            int barTypes = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(barTypes);
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboardOpen = insets.isVisible(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, keyboardOpen ? keyboard.bottom : bars.bottom);
            // The page is told there is nothing left to keep clear of. (The insets are set to
            // nothing, not marked as used up: a web view that is told "used up" stops
            // recalculating its own safe area.)
            return new WindowInsetsCompat.Builder(insets).setInsets(barTypes, Insets.of(0, 0, 0, 0)).build();
        });
        ViewCompat.requestApplyInsets(window);
    }
}
