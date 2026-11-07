package com.disciplineapp.survey

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.SystemClock
import android.provider.Settings
import com.disciplineapp.map.TrackService
import com.disciplineapp.map.TrackStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The Water Wolf survey being recorded, if any. GPS comes from [TrackService]
 * (the app's one location service), which forwards every fix here and keeps
 * running while a survey is active, with the screen off.
 *
 * Crash safety: the working state (events, times) is rewritten atomically to
 * surveys/active/state.json after every change, and every GPS point is
 * appended to surveys/active/points.jsonl as it arrives, so a killed process
 * resumes with nothing lost. A finished survey goes to [SurveyStore].
 */
object SurveySession {

    private val lock = Any()
    @Volatile private var record: SurveyRecord? = null
    @Volatile private var restored = false
    private var lastPersistMono = 0L

    private fun activeDir(context: Context) = File(SurveyStore.dir(context), "active").apply { mkdirs() }
    private fun stateFile(context: Context) = File(activeDir(context), "state.json")
    private fun pointsFile(context: Context) = File(activeDir(context), "points.jsonl")

    private fun now() = Moment(System.currentTimeMillis(), SystemClock.elapsedRealtime() + (record?.monoOffset ?: 0))

    private fun bootCount(context: Context) =
        runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrDefault(-1)

    fun isActive(context: Context): Boolean {
        restore(context)
        return record?.state?.active == true
    }

    /** Applies a button press and returns the new state; throws IllegalStateException when not allowed. */
    fun act(context: Context, action: SurveyAction, text: String? = null): JSONObject {
        restore(context)
        val (rec, before) = synchronized(lock) {
            if (action == SurveyAction.START_CAMERA && record == null) {
                pointsFile(context).delete()
                record = SurveyRecord(id = newId(), name = defaultName(), bootCount = bootCount(context))
            }
            val rec = record ?: throw IllegalStateException("No survey is running.")
            val before = SurveyJson.working(rec)
            rec.apply(action, now(), text)
            when (rec.state) {
                SurveyState.COMPLETED -> Unit // saved below, outside the lock
                SurveyState.DISCARDED -> clearActive(context)
                else -> persist(context, rec)
            }
            rec to before
        }
        if (rec.state == SurveyState.COMPLETED) {
            // No more points are appended once COMPLETED, so the files can be read without
            // holding the lock (GPS fixes arrive on the main thread and must not wait on this).
            try {
                finish(context, rec)
            } catch (e: Exception) {
                // Not saved: keep the survey running so nothing is lost, and say so.
                synchronized(lock) { record = SurveyJson.working(before) }
                TrackService.surveyChanged(context)
                throw IllegalStateException("The survey could not be saved: ${e.message}", e)
            }
        }
        TrackService.surveyChanged(context)
        return state(context)
    }

    /** Adds or changes a marker's description. */
    fun labelMarker(context: Context, number: Int, text: String?): Boolean {
        restore(context)
        synchronized(lock) {
            val rec = record ?: return false
            if (!rec.labelMarker(number, text)) return false
            persist(context, rec)
            return true
        }
    }

    // ---- from TrackService ----------------------------------------------------

    /** Every GPS fix. True when an event changed (worth refreshing the notification). */
    fun onFix(context: Context, loc: Location): Boolean {
        synchronized(lock) {
            val rec = record ?: return false
            if (!rec.state.active) return false
            val at = now()
            val fixMono = (loc.elapsedRealtimeNanos / 1_000_000) + rec.monoOffset
            val fix = Fix(
                lat = loc.latitude,
                lon = loc.longitude,
                mono = fixMono,
                gpsTime = loc.time,
                accuracy = if (loc.hasAccuracy()) round(loc.accuracy.toDouble(), 1) else null,
                speed = if (loc.hasSpeed()) round(loc.speed.toDouble(), 2) else null,
                altitude = if (loc.hasAltitude()) round(loc.altitude, 1) else null,
                bearing = if (loc.hasBearing()) round(loc.bearing.toDouble(), 1) else null,
            )
            val result = rec.onFix(fix, at)
            result.point?.let { p ->
                runCatching { pointsFile(context).appendText(SurveyJson.point(p).toString() + "\n") }
                    .onFailure { android.util.Log.e("SurveySession", "Could not store a GPS point", it) }
            }
            // lastFix is saved too (now and then), so events after a restart still find a position.
            if (result.eventsChanged || at.mono - lastPersistMono > PERSIST_FIX_MS) persist(context, rec)
            return result.eventsChanged
        }
    }

    /** About once a second. True when GPS was just declared lost. */
    fun tick(context: Context): Boolean = synchronized(lock) {
        val rec = record ?: return false
        if (!rec.tick(now())) return false
        persist(context, rec)
        true
    }

    fun onGpsDisabled(context: Context) = synchronized(lock) {
        val rec = record ?: return
        rec.signalLost(now(), "GPS turned off")
        persist(context, rec)
    }

    // ---- state ------------------------------------------------------------------

    fun state(context: Context): JSONObject {
        restore(context)
        synchronized(lock) {
            val rec = record ?: return JSONObject().put("state", SurveyState.IDLE.name)
            val at = now()
            val fix = rec.lastFix
            val fixAge = fix?.let { at.mono - it.mono }
            val gps = when {
                !gpsEnabled(context) -> "off"
                rec.gpsLost -> "lost"
                fix == null || fixAge!! > SurveyRecord.SIGNAL_LOST_MS -> "waiting"
                (fix.accuracy ?: 0.0) > WEAK_ACCURACY -> "weak"
                else -> "ok"
            }
            return JSONObject()
                .put("state", rec.state.name).put("id", rec.id).put("name", rec.name)
                .put("startedAt", rec.cameraStart?.utc ?: JSONObject.NULL)
                .put("cameraElapsedMs", rec.totalElapsedMs(at.mono))
                .put("surveyElapsedMs", rec.surveyElapsedMs(at.mono))
                .put("activeMovementMs", rec.activeMovementMs(at.mono))
                .put("pausedMs", rec.pausedMs(at.mono))
                .put("pointCount", rec.pointCount).put("markerCount", rec.markerCount).put("distance", rec.distance)
                .put("gps", gps)
                .put("accuracy", fix?.accuracy ?: JSONObject.NULL)
                .put("fixAgeMs", fixAge ?: JSONObject.NULL)
                .put("lat", fix?.lat ?: JSONObject.NULL).put("lon", fix?.lon ?: JSONObject.NULL)
                .put("speed", fix?.speed ?: JSONObject.NULL)
        }
    }

    fun gpsEnabled(context: Context) =
        runCatching { context.getSystemService(LocationManager::class.java).isProviderEnabled(LocationManager.GPS_PROVIDER) }
            .getOrDefault(true)

    // ---- persistence --------------------------------------------------------------

    /** Loads the running survey after a process restart (once). */
    fun restore(context: Context) {
        if (restored) return
        synchronized(lock) {
            if (restored) return
            restored = true
            val raw = runCatching { stateFile(context).readText() }.getOrNull() ?: return
            val rec = runCatching { SurveyJson.working(JSONObject(raw)) }.getOrNull() ?: return
            if (!rec.state.active) {
                clearActive(context)
                return
            }
            // Points and distance come back from the points file.
            var last: SurveyPoint? = null
            runCatching {
                pointsFile(context).takeIf { it.exists() }?.forEachLine { line ->
                    val p = runCatching { SurveyJson.point(JSONObject(line)) }.getOrNull() ?: return@forEachLine
                    val prev = last
                    if (prev != null && prev.segment == p.segment && (p.accuracy ?: 0.0) <= SurveyRecord.DISTANCE_MAX_ACCURACY) {
                        rec.distance += SurveyRecord.metersBetween(prev.lat, prev.lon, p.lat, p.lon)
                    }
                    rec.pointCount++
                    last = p
                }
            }
            rec.lastPoint = last?.takeIf { it.segment == rec.segment }
            val boot = bootCount(context)
            if (boot != -1 && rec.bootCount != -1 && boot != rec.bootCount) {
                val lastSeen = listOfNotNull(
                    last?.let { Moment(it.utc, it.mono) },
                    rec.events.lastOrNull()?.let { Moment(it.utc, it.mono) },
                ).maxByOrNull { it.mono }
                if (lastSeen != null) rec.onRestart(SystemClock.elapsedRealtime(), System.currentTimeMillis(), lastSeen, boot)
            }
            record = rec
            persist(context, rec)
        }
    }

    private fun persist(context: Context, rec: SurveyRecord) {
        lastPersistMono = SystemClock.elapsedRealtime() + rec.monoOffset
        runCatching { TrackStore.writeAtomic(stateFile(context), SurveyJson.working(rec).toString()) }
            .onFailure { android.util.Log.e("SurveySession", "Could not save the survey state", it) }
    }

    private fun finish(context: Context, rec: SurveyRecord) {
        val points = JSONArray()
        pointsFile(context).takeIf { it.exists() }?.forEachLine { line ->
            runCatching { points.put(JSONObject(line)) }
        }
        SurveyStore.save(context, SurveyJson.finished(rec, points))
        synchronized(lock) { if (record === rec) clearActive(context) }
    }

    private fun clearActive(context: Context) {
        stateFile(context).delete()
        pointsFile(context).delete()
        record = null
    }

    private fun newId() = "s${System.currentTimeMillis().toString(36)}"

    private fun defaultName() = "Survey ${SimpleDateFormat("d MMM yyyy HH:mm", Locale.getDefault()).format(Date())}"

    private fun round(v: Double, digits: Int): Double {
        val f = Math.pow(10.0, digits.toDouble())
        return Math.round(v * f) / f
    }

    /** Accuracy worse than this (m) shows as a weak signal. */
    private const val WEAK_ACCURACY = 20.0
    private const val PERSIST_FIX_MS = 10_000L
}
