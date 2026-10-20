package com.shclock.photos

import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugins.sharedpreferences.SharedPreferencesPlugin

class WallpaperActivity : com.shclock.photos.platform.flutter.WallpaperActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine.plugins.add(SharedPreferencesPlugin())
    }
}
