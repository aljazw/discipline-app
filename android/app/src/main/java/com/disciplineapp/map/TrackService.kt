package com.disciplineapp.map

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.disciplineapp.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Records a GPS track independently of the UI, with a live notification
 * (distance, time, speed) and Pause / Stop buttons. Started while the map is
 * open, so "while using the app" location access is enough: a foreground
 * service of type location keeps getting fixes with the screen off.
 *
 * Every accepted point is appended to tracks/current.jsonl right away, and
 * the summary goes to SharedPreferences, so if Android kills the process the
 * restarted service (START_STICKY) carries on with nothing lost.
 */
class TrackService : Service(), LocationListener {

    private val handler = Handler(Looper.getMainLooper())
    private var listening = false

    private val refresh = object : Runnable {
        override fun run() {
            if (recording == null) return
            notificationManager().notify(NOTIF_ID, buildNotification())
            handler.postDelayed(this, NOTIFY_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        ensureChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (recording == null) restore(this)
        startAsForeground(buildNotification())
        if (recording == null) {
            shutDown()
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_PAUSE -> pause(this)
            ACTION_RESUME -> resume(this)
            ACTION_STOP -> {
                stop(this)
                return START_NOT_STICKY
            }
        }
        startListening()
        handler.removeCallbacks(refresh)
        handler.post(refresh)
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopListening()
        handler.removeCallbacks(refresh)
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun startListening() {
        if (listening) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        val lm = getSystemService(LocationManager::class.java)
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, FIX_MS, 0f, this, Looper.getMainLooper())
            listening = true
        } catch (e: Exception) {
            android.util.Log.w("TrackService", "GPS unavailable", e)
        }
    }

    private fun stopListening() {
        if (!listening) return
        runCatching { getSystemService(LocationManager::class.java).removeUpdates(this) }
        listening = false
    }

    override fun onLocationChanged(location: Location) {
        val changed = synchronized(lock) { recording?.let { add(this, it, location) } ?: false }
        if (changed) persist(this)
    }

    // Older Android versions call these; nothing to do.
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    private fun shutDown() {
        stopListening()
        handler.removeCallbacks(refresh)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    // ---- notification -------------------------------------------------------

    private fun startAsForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val rec = synchronized(lock) { recording?.copy() }
        val builder = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_app)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setContentIntent(openAppIntent())
        if (rec == null) return builder.setContentTitle("Track saved").build()
        val parts = mutableListOf(formatDistance(rec.distance, rec.units), formatDuration(rec.elapsedMs()))
        if (!rec.paused && rec.lastSpeed >= 0) parts.add(formatSpeed(rec.lastSpeed, rec.units))
        builder
            .setContentTitle(if (rec.paused) "Track paused" else "Recording track")
            .setContentText(parts.joinToString(" · "))
            .addAction(
                0,
                if (rec.paused) "Resume" else "Pause",
                serviceIntent(if (rec.paused) ACTION_RESUME else ACTION_PAUSE, 1),
            )
            .addAction(0, "Stop and save", serviceIntent(ACTION_STOP, 2))
        return builder.build()
    }

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0,
        packageManager.getLaunchIntentForPackage(packageName)!!.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun serviceIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, TrackService::class.java).setAction(action)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PendingIntent.getForegroundService(this, requestCode, intent, flags)
        } else {
            PendingIntent.getService(this, requestCode, intent, flags)
        }
    }

    private fun notificationManager() = getSystemService(NotificationManager::class.java)

    /** The track being recorded. Distances in meters, speeds in m/s, times in ms. */
    data class Recording(
        val id: String,
        val name: String,
        val startedAt: Long,
        val units: String,
        var distance: Double = 0.0,
        var movingMs: Long = 0,
        var maxSpeed: Double = 0.0,
        var pointCount: Int = 0,
        var paused: Boolean = false,
        var pausedMs: Long = 0,
        var pausedAt: Long = 0,
        var lastLat: Double = Double.NaN,
        var lastLon: Double = Double.NaN,
        var lastTime: Long = 0,
        var lastSpeed: Double = -1.0,
    ) {
        fun elapsedMs(now: Long = System.currentTimeMillis()) =
            (if (paused) pausedAt else now) - startedAt - pausedMs

        fun toJson(status: String) = JSONObject()
            .put("status", status).put("id", id).put("name", name).put("startedAt", startedAt)
            .put("distance", distance).put("movingMs", movingMs).put("maxSpeed", maxSpeed)
            .put("pointCount", pointCount).put("elapsedMs", elapsedMs()).put("units", units)
    }

    companion object {
        private const val CHANNEL = "track_recording"
        private const val NOTIF_ID = 0x7A11
        private const val PREFS = "MapTrackPrefs"
        private const val KEY_STATE = "recording"
        private const val ACTION_RUN = "track.RUN"
        private const val ACTION_PAUSE = "track.PAUSE"
        private const val ACTION_RESUME = "track.RESUME"
        private const val ACTION_STOP = "track.STOP"
        private const val FIX_MS = 1000L
        private const val NOTIFY_MS = 5000L
        /** Fixes less accurate than this (meters) are ignored. */
        private const val MAX_ACCURACY = 35f
        /** A point is stored after moving this far (m)... */
        private const val MIN_STEP = 4.0
        /** ...or after this long, so stops still show in the track. */
        private const val MAX_GAP_MS = 30_000L
        /** Slower than this (m/s) counts as standing still. */
        private const val MOVING_SPEED = 0.5

        private val lock = Any()
        @Volatile private var recording: Recording? = null
        @Volatile private var instance: TrackService? = null

        fun start(context: Context, name: String, units: String) {
            synchronized(lock) {
                if (recording != null) throw IllegalStateException("A track is already being recorded.")
                currentFile(context).delete()
                recording = Recording(
                    id = "t${System.currentTimeMillis().toString(36)}",
                    name = name,
                    startedAt = System.currentTimeMillis(),
                    units = units,
                )
            }
            persist(context)
            launch(context, ACTION_RUN)
        }

        fun pause(context: Context) {
            synchronized(lock) {
                val rec = recording ?: return
                if (rec.paused) return
                rec.paused = true
                rec.pausedAt = System.currentTimeMillis()
                rec.lastSpeed = -1.0
            }
            persist(context)
            instance?.let { it.notificationManager().notify(NOTIF_ID, it.buildNotification()) }
        }

        fun resume(context: Context) {
            synchronized(lock) {
                val rec = recording ?: return
                if (!rec.paused) return
                rec.pausedMs += System.currentTimeMillis() - rec.pausedAt
                rec.paused = false
                // No distance across the pause: the next fix starts afresh.
                rec.lastLat = Double.NaN
            }
            persist(context)
            instance?.let { it.notificationManager().notify(NOTIF_ID, it.buildNotification()) }
        }

        /** Stops and saves the track; returns its summary, or null when nothing was recording. */
        fun stop(context: Context): JSONObject? {
            val rec = synchronized(lock) {
                val r = recording ?: return@synchronized null
                if (r.paused) {
                    r.pausedMs += System.currentTimeMillis() - r.pausedAt
                    r.paused = false
                }
                recording = null
                r
            }
            var saved: JSONObject? = null
            if (rec != null) {
                val points = readPoints(context, 0)
                if (points.length() > 0) {
                    val track = JSONObject()
                        .put("id", rec.id).put("name", rec.name)
                        .put("startedAt", rec.startedAt).put("endedAt", System.currentTimeMillis())
                        .put("distance", rec.distance).put("movingMs", rec.movingMs).put("maxSpeed", rec.maxSpeed)
                        .put("points", points)
                    TrackStore.save(context, track)
                    saved = track.apply { remove("points") }.put("pointCount", points.length())
                }
            }
            currentFile(context).delete()
            prefs(context).edit().remove(KEY_STATE).apply()
            instance?.shutDown()
            return saved
        }

        fun state(context: Context): JSONObject {
            synchronized(lock) {
                if (recording == null) restore(context)
                val rec = recording ?: return JSONObject().put("status", "idle")
                return rec.toJson(if (rec.paused) "paused" else "recording")
            }
        }

        /** Restarts the service after the process died mid-recording. */
        fun ensureRunning(context: Context) {
            if (instance == null && state(context).optString("status") != "idle") launch(context, ACTION_RUN)
        }

        /** The recorded points from index [from], as [[lat, lon, alt, time, speed]]. */
        fun readPoints(context: Context, from: Int): JSONArray {
            val out = JSONArray()
            val file = currentFile(context)
            if (!file.exists()) return out
            synchronized(lock) {
                file.useLines { lines ->
                    lines.drop(from).forEach { line -> runCatching { out.put(JSONArray(line)) } }
                }
            }
            return out
        }

        private fun add(context: Context, rec: Recording, loc: Location): Boolean {
            if (rec.paused) return false
            if (loc.hasAccuracy() && loc.accuracy > MAX_ACCURACY) return false
            val speed = if (loc.hasSpeed()) loc.speed.toDouble() else -1.0
            rec.lastSpeed = speed
            val now = loc.time
            if (!rec.lastLat.isNaN()) {
                val step = FloatArray(1)
                Location.distanceBetween(rec.lastLat, rec.lastLon, loc.latitude, loc.longitude, step)
                val moved = step[0].toDouble()
                val gap = now - rec.lastTime
                if (moved < MIN_STEP && gap < MAX_GAP_MS) return false
                // GPS drift while standing still isn't distance travelled.
                val stillDrift = speed in 0.0..MOVING_SPEED && moved < (if (loc.hasAccuracy()) loc.accuracy.toDouble() else 10.0)
                if (!stillDrift) rec.distance += moved
                if (speed > MOVING_SPEED || (speed < 0 && moved > MIN_STEP)) rec.movingMs += gap.coerceAtMost(MAX_GAP_MS)
            }
            if (speed > rec.maxSpeed) rec.maxSpeed = speed
            rec.lastLat = loc.latitude
            rec.lastLon = loc.longitude
            rec.lastTime = now
            rec.pointCount++
            val point = JSONArray()
                .put(round(loc.latitude, 7)).put(round(loc.longitude, 7))
                .put(if (loc.hasAltitude()) round(loc.altitude, 1) else 0.0)
                .put(now)
                .put(if (speed >= 0) round(speed, 2) else 0.0)
            currentFile(context).appendText(point.toString() + "\n")
            return true
        }

        private fun round(v: Double, digits: Int): Double {
            val f = Math.pow(10.0, digits.toDouble())
            return Math.round(v * f) / f
        }

        private fun launch(context: Context, action: String) {
            val intent = Intent(context, TrackService::class.java).setAction(action)
            ContextCompat.startForegroundService(context, intent)
        }

        private fun currentFile(context: Context) = File(File(context.filesDir, "tracks").apply { mkdirs() }, "current.jsonl")

        private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        private fun persist(context: Context) {
            val rec = synchronized(lock) { recording?.copy() } ?: return
            val json = rec.toJson("recording")
                .put("paused", rec.paused).put("pausedMs", rec.pausedMs).put("pausedAt", rec.pausedAt)
                .put("lastLat", if (rec.lastLat.isNaN()) null else rec.lastLat)
                .put("lastLon", if (rec.lastLon.isNaN()) null else rec.lastLon)
                .put("lastTime", rec.lastTime)
            prefs(context).edit().putString(KEY_STATE, json.toString()).apply()
        }

        private fun restore(context: Context) {
            val raw = prefs(context).getString(KEY_STATE, null) ?: return
            val j = runCatching { JSONObject(raw) }.getOrNull() ?: return
            recording = Recording(
                id = j.optString("id"),
                name = j.optString("name", "Track"),
                startedAt = j.optLong("startedAt"),
                units = j.optString("units", "metric"),
                distance = j.optDouble("distance", 0.0),
                movingMs = j.optLong("movingMs"),
                maxSpeed = j.optDouble("maxSpeed", 0.0),
                pointCount = j.optInt("pointCount"),
                paused = j.optBoolean("paused"),
                pausedMs = j.optLong("pausedMs"),
                pausedAt = j.optLong("pausedAt"),
                lastLat = if (j.isNull("lastLat")) Double.NaN else j.optDouble("lastLat"),
                lastLon = if (j.isNull("lastLon")) Double.NaN else j.optDouble("lastLon"),
                lastTime = j.optLong("lastTime"),
            )
        }

        private fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Track recording", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Distance, time and controls while a map track is being recorded."
                    setSound(null, null)
                    enableVibration(false)
                    setShowBadge(false)
                },
            )
        }

        fun formatDistance(meters: Double, units: String): String = when (units) {
            "nautical" -> "%.2f nm".format(meters / 1852)
            "imperial" -> if (meters < 160.9) "%.0f ft".format(meters * 3.28084) else "%.2f mi".format(meters / 1609.344)
            else -> if (meters < 1000) "%.0f m".format(meters) else "%.2f km".format(meters / 1000)
        }

        fun formatSpeed(mps: Double, units: String): String = when (units) {
            "nautical" -> "%.1f kn".format(mps * 1.943844)
            "imperial" -> "%.1f mph".format(mps * 2.236936)
            else -> "%.1f km/h".format(mps * 3.6)
        }

        private fun formatDuration(ms: Long): String {
            val s = (ms / 1000).coerceAtLeast(0)
            return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
        }
    }
}
