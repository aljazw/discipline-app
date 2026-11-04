package com.disciplineapp.map

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.LocationManager
import android.net.Uri
import android.provider.OpenableColumns
import android.view.WindowManager
import androidx.core.content.ContextCompat
import com.disciplineapp.appName
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * JS bridge for the map tool: offline map files and the local tile server,
 * GPX / KML / GeoJSON import and file export, the compass, and track
 * recording ([TrackService]). Results cross the bridge as JSON strings.
 *
 * Events: "MapImportProgress" {copied, total}, "MapCompass" {heading}.
 */
class MapModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), ActivityEventListener, SensorEventListener {

    private val io = Executors.newSingleThreadExecutor()
    /** Copying a big map takes minutes; it gets its own thread so the rest stays responsive. */
    private val copier = Executors.newSingleThreadExecutor()
    private var pending: Promise? = null
    private var pendingContent: String? = null
    private val cancelImport = AtomicBoolean(false)

    init {
        ctx.addActivityEventListener(this)
    }

    override fun getName(): String = "MapNative"

    // ---- map files ----------------------------------------------------------

    @ReactMethod
    fun serverUrl(promise: Promise) = respond(promise) { TileServer.baseUrl(ctx) }

    @ReactMethod
    fun listMaps(promise: Promise) = background(promise) { MapFiles.list(ctx).toString() }

    @ReactMethod
    fun mapsFolder(promise: Promise) = respond(promise) { MapFiles.dir(ctx).absolutePath }

    @ReactMethod
    fun removeMap(id: String, promise: Promise) = background(promise) { MapFiles.remove(ctx, id) }

    @ReactMethod
    fun renameMap(id: String, name: String, promise: Promise) = background(promise) { MapFiles.rename(ctx, id, name) }

    /** Picks a map file and copies it into the maps folder; resolves its info, or null if cancelled. */
    @ReactMethod
    fun importMap(promise: Promise) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
        launch(intent, REQUEST_MAP, promise, null)
    }

    @ReactMethod
    fun cancelImport() = cancelImport.set(true)

    private fun copyMap(uri: Uri, promise: Promise) {
        val name = displayName(uri) ?: "map.mbtiles"
        val ext = name.substringAfterLast('.', "").lowercase()
        if (ext !in MapFiles.EXTENSIONS) {
            promise.reject("unsupported", "Pick an .mbtiles or .pmtiles file. GPX, KML and GeoJSON go through Import places.")
            return
        }
        cancelImport.set(false)
        copier.execute {
            val target = MapFiles.target(ctx, name)
            val partial = File(target.parentFile, "${target.name}.part")
            try {
                val total = runCatching {
                    ctx.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
                }.getOrNull() ?: -1L
                val free = target.parentFile?.usableSpace ?: Long.MAX_VALUE
                if (total > 0 && total + SPACE_MARGIN > free) {
                    throw IllegalStateException(
                        "Not enough space: the map needs ${gb(total)}, the phone has ${gb(free)} free.",
                    )
                }
                ctx.contentResolver.openInputStream(uri)?.use { input ->
                    partial.outputStream().use { output ->
                        val buffer = ByteArray(1 shl 20)
                        var copied = 0L
                        var lastEmit = 0L
                        while (true) {
                            if (cancelImport.get()) throw InterruptedException("cancelled")
                            val n = input.read(buffer)
                            if (n < 0) break
                            output.write(buffer, 0, n)
                            copied += n
                            if (copied - lastEmit > PROGRESS_STEP) {
                                lastEmit = copied
                                emit("MapImportProgress", JSONObject().put("copied", copied).put("total", total))
                            }
                        }
                    }
                } ?: throw IllegalStateException("Could not open that file.")
                if (!partial.renameTo(target)) throw IllegalStateException("Could not save the map.")
                val info = runCatching { MapFiles.info(target) }.getOrElse {
                    target.delete()
                    throw IllegalStateException("That file isn't a map ${ctx.appName} can read.")
                }
                promise.resolve(info.toString())
            } catch (_: InterruptedException) {
                partial.delete()
                promise.resolve(null)
            } catch (e: Exception) {
                partial.delete()
                promise.reject("import_failed", e.message ?: "Could not import that map.", e)
            }
        }
    }

    private fun gb(bytes: Long) = if (bytes >= 1L shl 30) "%.1f GB".format(bytes / (1024.0 * 1024 * 1024))
    else "%.0f MB".format(bytes / (1024.0 * 1024))

    // ---- places files (GPX / KML / GeoJSON) ------------------------------------

    /** Picks a GPX, KML or GeoJSON file; resolves {fileName, marks, routes, tracks}, or null if cancelled. */
    @ReactMethod
    fun pickPlaces(promise: Promise) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
        launch(intent, REQUEST_PLACES, promise, null)
    }

    /** Saves text to a file the user picks, e.g. an exported GPX. Resolves false if cancelled. */
    @ReactMethod
    fun saveFile(fileName: String, mimeType: String, content: String, promise: Promise) {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, fileName)
        launch(intent, REQUEST_SAVE, promise, content)
    }

    private fun launch(intent: Intent, request: Int, promise: Promise, content: String?) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("no_activity", "Open ${ctx.appName} to pick a file.")
            return
        }
        pending?.resolve(null)
        pending = promise
        pendingContent = content
        try {
            activity.startActivityForResult(intent, request)
        } catch (e: Exception) {
            pending = null
            pendingContent = null
            promise.reject("picker_failed", e)
        }
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_MAP && requestCode != REQUEST_PLACES && requestCode != REQUEST_SAVE) return
        val promise = pending ?: return
        val content = pendingContent
        pending = null
        pendingContent = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            promise.resolve(if (requestCode == REQUEST_SAVE) false else null)
            return
        }
        when (requestCode) {
            REQUEST_MAP -> copyMap(uri, promise)
            REQUEST_PLACES -> io.execute {
                try {
                    val name = displayName(uri) ?: "places.gpx"
                    val bytes = ctx.contentResolver.openInputStream(uri)?.use { input ->
                        input.readBytes().also {
                            if (it.size > MAX_PLACES_BYTES) throw IllegalStateException("That file is too large (over 50 MB).")
                        }
                    } ?: throw IllegalStateException("Could not open that file.")
                    val parsed = GeoImport.parse(String(bytes, Charsets.UTF_8), name).put("fileName", name)
                    promise.resolve(parsed.toString())
                } catch (e: Exception) {
                    promise.reject("places_failed", e.message ?: "Could not read that file.", e)
                }
            }
            REQUEST_SAVE -> io.execute {
                try {
                    ctx.contentResolver.openOutputStream(uri, "wt")?.use { it.write((content ?: "").toByteArray(Charsets.UTF_8)) }
                        ?: throw IllegalStateException("Could not open the file for writing.")
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("save_failed", e.message ?: "Could not save the file.", e)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent?) { /* no-op */ }

    private fun displayName(uri: Uri): String? = runCatching {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/')

    // ---- tracks -------------------------------------------------------------

    @ReactMethod
    fun startTrack(name: String, units: String, promise: Promise) = respond(promise) {
        TrackService.start(ctx, name, units)
        TrackService.state(ctx).toString()
    }

    @ReactMethod
    fun pauseTrack(promise: Promise) = respond(promise) { TrackService.pause(ctx); TrackService.state(ctx).toString() }

    @ReactMethod
    fun resumeTrack(promise: Promise) = respond(promise) { TrackService.resume(ctx); TrackService.state(ctx).toString() }

    /** Stops and saves; resolves the saved track's summary, or null if it had no points. */
    @ReactMethod
    fun stopTrack(promise: Promise) = background(promise) { TrackService.stop(ctx)?.toString() }

    @ReactMethod
    fun trackState(promise: Promise) = respond(promise) {
        TrackService.ensureRunning(ctx)
        TrackService.state(ctx).toString()
    }

    /** Points of the track being recorded, from index [from]. */
    @ReactMethod
    fun trackPoints(from: Int, promise: Promise) = background(promise) { TrackService.readPoints(ctx, from).toString() }

    @ReactMethod
    fun listTracks(promise: Promise) = background(promise) { TrackStore.list(ctx).toString() }

    @ReactMethod
    fun getTrack(id: String, promise: Promise) = background(promise) { TrackStore.get(ctx, id)?.toString() }

    @ReactMethod
    fun saveTrack(json: String, promise: Promise) = background(promise) { TrackStore.save(ctx, JSONObject(json)); true }

    @ReactMethod
    fun deleteTrack(id: String, promise: Promise) = background(promise) { TrackStore.delete(ctx, id) }

    @ReactMethod
    fun renameTrack(id: String, name: String, promise: Promise) = background(promise) { TrackStore.rename(ctx, id, name) }

    // ---- compass ------------------------------------------------------------

    private var sensors: SensorManager? = null
    private val rotation = FloatArray(9)
    private val orientation = FloatArray(3)
    private var declination = 0f
    private var smoothed = Float.NaN
    private var lastEmit = 0L

    @ReactMethod
    fun startCompass() {
        val manager = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) ?: return
        declination = trueNorthOffset()
        sensors?.unregisterListener(this)
        sensors = manager
        manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
    }

    @ReactMethod
    fun stopCompass() {
        sensors?.unregisterListener(this)
        sensors = null
        smoothed = Float.NaN
    }

    /** Magnetic declination at the last known position, so headings point to true north. */
    private fun trueNorthOffset(): Float {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return 0f
        }
        val lm = ctx.getSystemService(LocationManager::class.java)
        val last = runCatching {
            lm.getLastKnownLocation(LocationManager.GPS_PROVIDER) ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
        }.getOrNull() ?: return 0f
        return GeomagneticField(
            last.latitude.toFloat(), last.longitude.toFloat(), last.altitude.toFloat(), System.currentTimeMillis(),
        ).declination
    }

    override fun onSensorChanged(event: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        SensorManager.getOrientation(rotation, orientation)
        val heading = (Math.toDegrees(orientation[0].toDouble()).toFloat() + declination + 360f) % 360f
        // Low-pass filter on the circle, so the needle doesn't jitter or spin at 0°/360°.
        smoothed = if (smoothed.isNaN()) heading else {
            var delta = heading - smoothed
            if (delta > 180) delta -= 360
            if (delta < -180) delta += 360
            (smoothed + delta * 0.2f + 360f) % 360f
        }
        val now = System.currentTimeMillis()
        if (now - lastEmit < COMPASS_MS) return
        lastEmit = now
        val map = Arguments.createMap().apply { putDouble("heading", smoothed.toDouble()) }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("MapCompass", map)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    // ---- misc ---------------------------------------------------------------

    /** Keeps the screen on while the map is open, if the user wants it. */
    @ReactMethod
    fun setKeepAwake(enabled: Boolean) {
        val activity = currentActivity ?: return
        activity.runOnUiThread {
            if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    // Required by NativeEventEmitter.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    override fun invalidate() {
        stopCompass()
        super.invalidate()
    }

    private fun emit(event: String, json: JSONObject) {
        val map = Arguments.createMap()
        json.keys().forEach { key ->
            when (val v = json.get(key)) {
                is Number -> map.putDouble(key, v.toDouble())
                else -> map.putString(key, v.toString())
            }
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, map)
    }

    private fun respond(promise: Promise, block: () -> Any?) {
        try {
            promise.resolve(block())
        } catch (e: IllegalStateException) {
            promise.reject("map_busy", e.message, e)
        } catch (e: Exception) {
            promise.reject("map_error", e.message, e)
        }
    }

    /** Runs file work off the UI thread. */
    private fun background(promise: Promise, block: () -> Any?) = io.execute { respond(promise, block) }

    companion object {
        private const val REQUEST_MAP = 0x6B01
        private const val REQUEST_PLACES = 0x6B02
        private const val REQUEST_SAVE = 0x6B03
        private const val PROGRESS_STEP = 8L * 1024 * 1024
        private const val SPACE_MARGIN = 200L * 1024 * 1024
        private const val MAX_PLACES_BYTES = 50 * 1024 * 1024
        private const val COMPASS_MS = 150L
    }
}
