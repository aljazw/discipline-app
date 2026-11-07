package com.disciplineapp.survey

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.disciplineapp.map.TrackService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

/**
 * JS bridge for Water Wolf survey recording ([SurveySession]) and saved
 * surveys ([SurveyStore]). Results cross the bridge as JSON strings.
 */
class SurveyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    private val io = Executors.newSingleThreadExecutor()

    override fun getName(): String = "SurveyNative"

    // ---- recording ----------------------------------------------------------

    @ReactMethod
    fun state(promise: Promise) = respond(promise) {
        TrackService.ensureRunning(ctx)
        SurveySession.state(ctx).toString()
    }

    /** Points recorded so far from index [from], for drawing the live survey line. */
    @ReactMethod
    fun points(from: Int, promise: Promise) = background(promise) { SurveySession.points(ctx, from).toString() }

    @ReactMethod
    fun startCamera(promise: Promise) = act(promise, SurveyAction.START_CAMERA)

    @ReactMethod
    fun startMoving(promise: Promise) = act(promise, SurveyAction.START_MOVING)

    @ReactMethod
    fun pause(promise: Promise) = act(promise, SurveyAction.PAUSE)

    @ReactMethod
    fun resume(promise: Promise) = act(promise, SurveyAction.RESUME)

    /** Saving reads every point, so it runs off the UI thread. Resolves the state (IDLE once saved). */
    @ReactMethod
    fun stop(promise: Promise) = background(promise) { SurveySession.act(ctx, SurveyAction.STOP).toString() }

    @ReactMethod
    fun discard(promise: Promise) = act(promise, SurveyAction.DISCARD)

    @ReactMethod
    fun addMarker(text: String?, promise: Promise) = respond(promise) {
        SurveySession.act(ctx, SurveyAction.ADD_MARKER, text).toString()
    }

    @ReactMethod
    fun labelMarker(number: Int, text: String?, promise: Promise) = respond(promise) {
        SurveySession.labelMarker(ctx, number, text)
    }

    private fun act(promise: Promise, action: SurveyAction) = respond(promise) { SurveySession.act(ctx, action).toString() }

    // ---- saved surveys --------------------------------------------------------

    @ReactMethod
    fun list(promise: Promise) = background(promise) { SurveyStore.list(ctx).toString() }

    @ReactMethod
    fun get(id: String, promise: Promise) = background(promise) { SurveyStore.get(ctx, id)?.toString() }

    @ReactMethod
    fun remove(id: String, promise: Promise) = background(promise) { SurveyStore.delete(ctx, id) }

    @ReactMethod
    fun rename(id: String, name: String, promise: Promise) = background(promise) { SurveyStore.rename(ctx, id, name) }

    // ---- phone settings -------------------------------------------------------

    @ReactMethod
    fun gpsEnabled(promise: Promise) = respond(promise) { SurveySession.gpsEnabled(ctx) }

    /** True when battery optimization can't pause the app in the background. */
    @ReactMethod
    fun batteryUnrestricted(promise: Promise) = respond(promise) {
        ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)
    }

    /** Asks Android to let the app run unrestricted; falls back to the battery settings list. */
    @SuppressLint("BatteryLife")
    @ReactMethod
    fun requestBatteryUnrestricted(promise: Promise) = respond(promise) {
        val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        val intent = if (ask.resolveActivity(ctx.packageManager) != null) ask else list
        (currentActivity ?: ctx).startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    }

    @ReactMethod
    fun openLocationSettings(promise: Promise) = respond(promise) {
        (currentActivity ?: ctx).startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    }

    private fun respond(promise: Promise, block: () -> Any?) {
        try {
            promise.resolve(block())
        } catch (e: IllegalStateException) {
            promise.reject("survey_refused", e.message, e)
        } catch (e: Exception) {
            promise.reject("survey_error", e.message, e)
        }
    }

    private fun background(promise: Promise, block: () -> Any?) = io.execute { respond(promise, block) }
}
