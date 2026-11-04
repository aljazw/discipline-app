package com.disciplineapp.modules

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.disciplineapp.OverlayModule
import com.disciplineapp.VpnControlModule
import com.disciplineapp.WatchdogModule
import com.disciplineapp.alarm.WakeAlarmModule
import com.disciplineapp.apnea.ApneaModule
import com.disciplineapp.map.MapModule
import com.disciplineapp.music.MusicModule
import com.disciplineapp.notes.NoteCryptoModule
import com.disciplineapp.video.PromiseVideoModule

/** Registers every native module of the app. Add new modules to this list. */
class AppPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(
            SharedStorageModule(reactContext),
            AccessibilityStatusModule(reactContext),
            IntentLauncherModule(reactContext),
            DeviceAdminModule(reactContext),
            VpnControlModule(reactContext),
            OverlayModule(reactContext),
            WatchdogModule(reactContext),
            InstalledAppsModule(reactContext),
            ApneaModule(reactContext),
            HapticsModule(reactContext),
            BackupFileModule(reactContext),
            MusicModule(reactContext),
            WakeAlarmModule(reactContext),
            PromiseVideoModule(reactContext),
            NoteCryptoModule(reactContext),
            MapModule(reactContext),
        )

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
