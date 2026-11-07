package com.disciplineapp.survey

/**
 * The Water Wolf survey recorder's rules, with no Android in it, so it can be
 * unit tested: the states, which button is allowed in which state, and how
 * events, GPS points and durations are worked out.
 *
 * Times: every moment is a [Moment] of UTC wall clock (`utc`, for matching
 * with the outside world) and Android's monotonic elapsed time (`mono`,
 * SystemClock.elapsedRealtime, for durations and ordering). Durations are
 * always computed from `mono`, never by subtracting wall-clock times.
 */
enum class SurveyState {
    IDLE,
    CAMERA_RECORDING_STARTED,
    MOVING,
    PAUSED,
    COMPLETED,
    DISCARDED;

    val active get() = this == CAMERA_RECORDING_STARTED || this == MOVING || this == PAUSED
}

enum class SurveyAction { START_CAMERA, START_MOVING, PAUSE, RESUME, STOP, DISCARD, ADD_MARKER }

object SurveyEventType {
    const val CAMERA_RECORDING_STARTED = "CAMERA_RECORDING_STARTED"
    const val MOVEMENT_STARTED = "MOVEMENT_STARTED"
    const val PAUSED = "PAUSED"
    const val RESUMED = "RESUMED"
    const val MARKER_ADDED = "MARKER_ADDED"
    const val SURVEY_STOPPED = "SURVEY_STOPPED"
    const val SURVEY_DISCARDED = "SURVEY_DISCARDED"
    /** No GPS fix for [SurveyRecord.SIGNAL_LOST_MS] while moving, or GPS turned off. */
    const val GPS_LOST = "GPS_LOST"
    const val GPS_RESTORED = "GPS_RESTORED"
    /** The phone restarted mid-survey; `mono` restarts from zero, see [SurveyRecord.monoOffset]. */
    const val DEVICE_RESTARTED = "DEVICE_RESTARTED"
}

object SurveyMachine {
    /** The state after [action], or null when the action isn't allowed in [state]. */
    fun next(state: SurveyState, action: SurveyAction): SurveyState? = when (action) {
        SurveyAction.START_CAMERA -> if (state == SurveyState.IDLE) SurveyState.CAMERA_RECORDING_STARTED else null
        SurveyAction.START_MOVING -> if (state == SurveyState.CAMERA_RECORDING_STARTED) SurveyState.MOVING else null
        SurveyAction.PAUSE -> if (state == SurveyState.MOVING) SurveyState.PAUSED else null
        SurveyAction.RESUME -> if (state == SurveyState.PAUSED) SurveyState.MOVING else null
        SurveyAction.STOP -> if (state == SurveyState.MOVING || state == SurveyState.PAUSED) SurveyState.COMPLETED else null
        // The only way out before moving, in case the boat never sets off.
        SurveyAction.DISCARD -> if (state == SurveyState.CAMERA_RECORDING_STARTED) SurveyState.DISCARDED else null
        SurveyAction.ADD_MARKER -> if (state.active) state else null
    }

    fun allowed(state: SurveyState): List<SurveyAction> = SurveyAction.values().filter { next(state, it) != null }
}

/** One instant on both clocks. `mono` is in ms. */
data class Moment(val utc: Long, val mono: Long)

/** A GPS fix as the recorder sees it. `mono` is when the fix was taken (Location.elapsedRealtimeNanos). */
data class Fix(
    val lat: Double,
    val lon: Double,
    val mono: Long,
    /** Satellite / provider time (Location.time), an independent clock reference. */
    val gpsTime: Long,
    val accuracy: Double? = null,
    val speed: Double? = null,
    val altitude: Double? = null,
    val bearing: Double? = null,
    /** "gps" (satellites), or "fused" / "network" for a quick but rougher fix. */
    val provider: String? = null,
)

/** A stored track point. `segment` counts up after every pause, so paused gaps are explicit. */
data class SurveyPoint(
    val utc: Long,
    val mono: Long,
    val lat: Double,
    val lon: Double,
    val accuracy: Double?,
    val speed: Double?,
    val altitude: Double?,
    val bearing: Double?,
    val gpsTime: Long,
    val segment: Int,
    val provider: String? = null,
)

data class SurveyEvent(
    val type: String,
    val utc: Long,
    val mono: Long,
    var lat: Double? = null,
    var lon: Double? = null,
    var accuracy: Double? = null,
    /**
     * Age of the fix used for the position: positive = taken that long before
     * the event; negative = the first fix that arrived after it (no fresh fix
     * at the moment of the event).
     */
    var fixAgeMs: Long? = null,
    /** True while waiting for a fix to fill in the position. */
    var positionPending: Boolean = false,
    /** Marker description, or the reason for GPS_LOST. */
    var text: String? = null,
    /** Marker number, 1, 2, 3... within the survey. */
    val number: Int? = null,
)

/** A period with no GPS collection. `end` is null while still paused. */
data class Pause(val start: Moment, val end: Moment?) {
    fun durationMs(nowMono: Long) = (end?.mono ?: nowMono) - start.mono
}

class SurveyRecord(
    val id: String,
    var name: String,
    /** Settings.Global.BOOT_COUNT when the survey started; tells a phone restart from a process restart. */
    var bootCount: Int,
    var state: SurveyState = SurveyState.IDLE,
    val events: MutableList<SurveyEvent> = mutableListOf(),
    var cameraStart: Moment? = null,
    var movementStart: Moment? = null,
    var stop: Moment? = null,
    /** Finished moving time; the current stretch is added on top while MOVING. */
    var activeMs: Long = 0,
    /** Start of the current moving stretch (MOVING only), else -1. */
    var segmentStartMono: Long = -1,
    var segment: Int = -1,
    var pointCount: Int = 0,
    var markerCount: Int = 0,
    /** Meters along the stored points, without jumps over pauses. */
    var distance: Double = 0.0,
    var lastFix: Fix? = null,
    var lastPoint: SurveyPoint? = null,
    var gpsLost: Boolean = false,
    /**
     * Added to the phone's monotonic clock after a restart, so `mono` stays one
     * continuous timeline for the whole survey (0 unless the phone rebooted).
     */
    var monoOffset: Long = 0,
) {

    fun allowed(action: SurveyAction) = SurveyMachine.next(state, action) != null

    /** Applies a button press; throws [IllegalStateException] when it isn't allowed now. */
    fun apply(action: SurveyAction, at: Moment, text: String? = null): SurveyEvent {
        val target = SurveyMachine.next(state, action)
            ?: throw IllegalStateException(refusal(action))
        val event = when (action) {
            SurveyAction.START_CAMERA -> {
                cameraStart = at
                event(SurveyEventType.CAMERA_RECORDING_STARTED, at)
            }
            SurveyAction.START_MOVING -> {
                movementStart = at
                segment = 0
                segmentStartMono = at.mono
                event(SurveyEventType.MOVEMENT_STARTED, at)
            }
            SurveyAction.PAUSE -> {
                activeMs += at.mono - segmentStartMono
                segmentStartMono = -1
                event(SurveyEventType.PAUSED, at)
            }
            SurveyAction.RESUME -> {
                segment++
                segmentStartMono = at.mono
                lastPoint = null
                event(SurveyEventType.RESUMED, at)
            }
            SurveyAction.STOP -> {
                if (state == SurveyState.MOVING) activeMs += at.mono - segmentStartMono
                segmentStartMono = -1
                stop = at
                event(SurveyEventType.SURVEY_STOPPED, at).also { it.positionPending = false }
            }
            SurveyAction.DISCARD -> {
                stop = at
                event(SurveyEventType.SURVEY_DISCARDED, at).also { it.positionPending = false }
            }
            SurveyAction.ADD_MARKER -> {
                markerCount++
                event(SurveyEventType.MARKER_ADDED, at, text?.trim()?.takeIf { it.isNotEmpty() }, markerCount)
            }
        }
        state = target
        return event
    }

    /** Sets or changes a marker's description after it was dropped. */
    fun labelMarker(number: Int, text: String?): Boolean {
        val marker = events.firstOrNull { it.type == SurveyEventType.MARKER_ADDED && it.number == number } ?: return false
        marker.text = text?.trim()?.takeIf { it.isNotEmpty() }
        return true
    }

    data class FixResult(val point: SurveyPoint?, val eventsChanged: Boolean)

    /** Takes in a GPS fix; returns the point to store, if the survey is collecting. */
    fun onFix(fix: Fix, at: Moment): FixResult {
        val previous = lastFix
        if (previous != null && fix.mono <= previous.mono) return FixResult(null, false)
        lastFix = fix
        var changed = false
        // Events that had no fresh fix get the first one after them.
        for (e in events) {
            if (!e.positionPending) continue
            if (fix.mono - e.mono <= PENDING_FIX_MS) {
                e.lat = fix.lat; e.lon = fix.lon; e.accuracy = fix.accuracy
                e.fixAgeMs = e.mono - fix.mono
            }
            e.positionPending = false
            changed = true
        }
        if (gpsLost) {
            gpsLost = false
            events.add(event(SurveyEventType.GPS_RESTORED, at))
            changed = true
        }
        if (state != SurveyState.MOVING || fix.mono < segmentStartMono) return FixResult(null, changed)
        val point = SurveyPoint(
            utc = at.utc - (at.mono - fix.mono),
            mono = fix.mono,
            lat = fix.lat,
            lon = fix.lon,
            accuracy = fix.accuracy,
            speed = fix.speed,
            altitude = fix.altitude,
            bearing = fix.bearing,
            gpsTime = fix.gpsTime,
            segment = segment,
            provider = fix.provider,
        )
        lastPoint?.let { last ->
            // Badly placed fixes are kept as points but don't add to the distance.
            if ((fix.accuracy ?: 0.0) <= DISTANCE_MAX_ACCURACY) distance += metersBetween(last.lat, last.lon, fix.lat, fix.lon)
        }
        if ((fix.accuracy ?: 0.0) <= DISTANCE_MAX_ACCURACY || lastPoint == null) lastPoint = point
        pointCount++
        return FixResult(point, changed)
    }

    /**
     * Called about once a second; true when it added an event (signal lost).
     * Before the very first fix there is nothing to lose: that is "waiting for
     * GPS" (a cold start can take minutes), not a lost signal.
     */
    fun tick(at: Moment): Boolean {
        val fix = lastFix ?: return false
        if (state != SurveyState.MOVING || gpsLost) return false
        val since = maxOf(fix.mono, segmentStartMono)
        if (at.mono - since < SIGNAL_LOST_MS) return false
        signalLost(at, "no fix for ${(at.mono - since) / 1000} s")
        return true
    }

    /** GPS switched off, or nothing heard for a while. */
    fun signalLost(at: Moment, reason: String) {
        if (gpsLost || !state.active) return
        gpsLost = true
        events.add(event(SurveyEventType.GPS_LOST, at, reason).also { it.positionPending = false })
    }

    /**
     * The phone restarted mid-survey: its monotonic clock began again at zero.
     * [rawNow] is the new raw elapsedRealtime; [lastSeen] the last moment
     * recorded before the restart. Shifts the clock by the wall-clock gap so
     * durations keep counting, and closes the moving stretch there.
     */
    fun onRestart(rawNow: Long, utcNow: Long, lastSeen: Moment, newBootCount: Int) {
        val gap = (utcNow - lastSeen.utc).coerceAtLeast(0)
        monoOffset = lastSeen.mono + gap - rawNow
        bootCount = newBootCount
        val at = Moment(utcNow, rawNow + monoOffset)
        if (state == SurveyState.MOVING) {
            // Time while the phone was off isn't counted as moving with GPS.
            activeMs += lastSeen.mono - segmentStartMono
            segment++
            segmentStartMono = at.mono
            lastPoint = null
        }
        lastFix = null
        events.add(event(SurveyEventType.DEVICE_RESTARTED, at, "monotonic clock offset $monoOffset ms").also { it.positionPending = false })
    }

    // ---- durations ------------------------------------------------------------

    /** Camera start to now (or stop). */
    fun totalElapsedMs(nowMono: Long) = cameraStart?.let { (stop?.mono ?: nowMono) - it.mono } ?: 0

    /** Movement start to now (or stop), pauses included. */
    fun surveyElapsedMs(nowMono: Long) = movementStart?.let { (stop?.mono ?: nowMono) - it.mono } ?: 0

    /** Time actually moving with GPS collection on. */
    fun activeMovementMs(nowMono: Long) =
        activeMs + if (state == SurveyState.MOVING && segmentStartMono >= 0) nowMono - segmentStartMono else 0

    fun pausedMs(nowMono: Long) = pauses().sumOf { it.durationMs(stop?.mono ?: nowMono) }

    /** Every pause, from the PAUSED / RESUMED events (a pause still open at stop ends there). */
    fun pauses(): List<Pause> {
        val out = mutableListOf<Pause>()
        var open: Moment? = null
        for (e in events) {
            when (e.type) {
                SurveyEventType.PAUSED -> open = Moment(e.utc, e.mono)
                SurveyEventType.RESUMED, SurveyEventType.SURVEY_STOPPED -> open?.let {
                    out.add(Pause(it, Moment(e.utc, e.mono)))
                    open = null
                }
            }
        }
        open?.let { out.add(Pause(it, null)) }
        return out
    }

    // ---- helpers --------------------------------------------------------------

    private fun event(type: String, at: Moment, text: String? = null, number: Int? = null): SurveyEvent {
        val fix = lastFix
        val e = SurveyEvent(type = type, utc = at.utc, mono = at.mono, text = text, number = number)
        if (fix != null && at.mono - fix.mono <= FRESH_FIX_MS) {
            e.lat = fix.lat; e.lon = fix.lon; e.accuracy = fix.accuracy
            e.fixAgeMs = at.mono - fix.mono
        } else {
            e.positionPending = true
        }
        if (type != SurveyEventType.GPS_LOST && type != SurveyEventType.GPS_RESTORED) events.add(e)
        return e
    }

    private fun refusal(action: SurveyAction) = when (action) {
        SurveyAction.START_CAMERA -> "A survey is already running."
        SurveyAction.START_MOVING -> "Press Recording started first."
        SurveyAction.PAUSE -> "You can only pause while moving."
        SurveyAction.RESUME -> "The survey isn't paused."
        SurveyAction.STOP -> "Start moving before stopping the survey."
        SurveyAction.DISCARD -> "Only a survey that hasn't started moving can be discarded."
        SurveyAction.ADD_MARKER -> "Markers need a running survey."
    }

    companion object {
        /** A fix up to this old (ms) gives an event its position. */
        const val FRESH_FIX_MS = 10_000L
        /** A fix up to this long after an event fills in a missing position. */
        const val PENDING_FIX_MS = 30_000L
        /** No fix for this long while moving = GPS_LOST. */
        const val SIGNAL_LOST_MS = 5_000L
        /** Fixes worse than this (m) are stored but not counted in the distance. */
        const val DISTANCE_MAX_ACCURACY = 30.0

        fun metersBetween(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val r = 6_371_008.8
            val p1 = Math.toRadians(lat1)
            val p2 = Math.toRadians(lat2)
            val dp = p2 - p1
            val dl = Math.toRadians(lon2 - lon1)
            val a = Math.sin(dp / 2).let { it * it } + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2).let { it * it }
            return 2 * r * Math.asin(Math.sqrt(a.coerceIn(0.0, 1.0)))
        }
    }
}
