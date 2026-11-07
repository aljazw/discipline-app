package com.disciplineapp.survey

import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone

/**
 * The survey file format (version 1). Times: `utc` = Unix ms, UTC wall clock;
 * `mono` = Android SystemClock.elapsedRealtime in ms (+ clock.monoOffsetMs
 * after a phone restart), the reliable clock for durations and ordering.
 */
object SurveyJson {
    const val FORMAT = "water-wolf-survey"
    const val VERSION = 1

    private fun JSONObject.putNullable(key: String, value: Double?) = put(key, value ?: JSONObject.NULL)
    private fun JSONObject.optNumber(key: String): Double? = if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }
    private fun JSONObject.optLongOrNull(key: String): Long? = if (isNull(key)) null else optLong(key)

    fun moment(m: Moment?): Any = m?.let { JSONObject().put("utc", it.utc).put("mono", it.mono) } ?: JSONObject.NULL
    fun moment(j: JSONObject, key: String): Moment? = j.optJSONObject(key)?.let { Moment(it.getLong("utc"), it.getLong("mono")) }

    fun event(e: SurveyEvent): JSONObject = JSONObject()
        .put("type", e.type).put("utc", e.utc).put("mono", e.mono)
        .putNullable("lat", e.lat).putNullable("lon", e.lon).putNullable("accuracy", e.accuracy)
        .put("fixAgeMs", e.fixAgeMs ?: JSONObject.NULL)
        .apply {
            if (e.positionPending) put("positionPending", true)
            if (e.text != null) put("text", e.text)
            if (e.number != null) put("number", e.number)
        }

    fun event(j: JSONObject) = SurveyEvent(
        type = j.getString("type"),
        utc = j.getLong("utc"),
        mono = j.getLong("mono"),
        lat = j.optNumber("lat"),
        lon = j.optNumber("lon"),
        accuracy = j.optNumber("accuracy"),
        fixAgeMs = j.optLongOrNull("fixAgeMs"),
        positionPending = j.optBoolean("positionPending"),
        text = if (j.isNull("text")) null else j.optString("text"),
        number = if (j.has("number")) j.getInt("number") else null,
    )

    fun point(p: SurveyPoint): JSONObject = JSONObject()
        .put("utc", p.utc).put("mono", p.mono)
        .put("lat", p.lat).put("lon", p.lon)
        .putNullable("accuracy", p.accuracy).putNullable("speed", p.speed).putNullable("altitude", p.altitude).putNullable("bearing", p.bearing)
        .put("gpsTime", p.gpsTime).put("segment", p.segment)
        .put("provider", p.provider ?: JSONObject.NULL)

    fun point(j: JSONObject) = SurveyPoint(
        utc = j.getLong("utc"),
        mono = j.getLong("mono"),
        lat = j.getDouble("lat"),
        lon = j.getDouble("lon"),
        accuracy = j.optNumber("accuracy"),
        speed = j.optNumber("speed"),
        altitude = j.optNumber("altitude"),
        bearing = j.optNumber("bearing"),
        gpsTime = j.optLong("gpsTime"),
        segment = j.optInt("segment"),
        provider = if (j.isNull("provider")) null else j.optString("provider"),
    )

    private fun fix(f: Fix?): Any = f?.let {
        JSONObject().put("lat", it.lat).put("lon", it.lon).put("mono", it.mono).put("gpsTime", it.gpsTime)
            .putNullable("accuracy", it.accuracy).putNullable("speed", it.speed).putNullable("altitude", it.altitude).putNullable("bearing", it.bearing)
            .put("provider", it.provider ?: JSONObject.NULL)
    } ?: JSONObject.NULL

    private fun fix(j: JSONObject?): Fix? = j?.let {
        Fix(
            lat = it.getDouble("lat"), lon = it.getDouble("lon"), mono = it.getLong("mono"), gpsTime = it.optLong("gpsTime"),
            accuracy = it.optNumber("accuracy"), speed = it.optNumber("speed"),
            altitude = it.optNumber("altitude"), bearing = it.optNumber("bearing"),
            provider = if (it.isNull("provider")) null else it.optString("provider"),
        )
    }

    /** The running survey's working state, saved after every change (points live in their own file). */
    fun working(r: SurveyRecord): JSONObject = JSONObject()
        .put("id", r.id).put("name", r.name).put("bootCount", r.bootCount).put("state", r.state.name)
        .put("events", JSONArray().apply { r.events.forEach { put(event(it)) } })
        .put("cameraStart", moment(r.cameraStart)).put("movementStart", moment(r.movementStart)).put("stop", moment(r.stop))
        .put("activeMs", r.activeMs).put("segmentStartMono", r.segmentStartMono).put("segment", r.segment)
        .put("markerCount", r.markerCount).put("gpsLost", r.gpsLost).put("monoOffset", r.monoOffset)
        .put("lastFix", fix(r.lastFix))

    fun working(j: JSONObject): SurveyRecord {
        val events = j.optJSONArray("events") ?: JSONArray()
        return SurveyRecord(
            id = j.getString("id"),
            name = j.optString("name", "Survey"),
            bootCount = j.optInt("bootCount", -1),
            state = runCatching { SurveyState.valueOf(j.getString("state")) }.getOrDefault(SurveyState.IDLE),
            events = (0 until events.length()).map { event(events.getJSONObject(it)) }.toMutableList(),
            cameraStart = moment(j, "cameraStart"),
            movementStart = moment(j, "movementStart"),
            stop = moment(j, "stop"),
            activeMs = j.optLong("activeMs"),
            segmentStartMono = j.optLong("segmentStartMono", -1),
            segment = j.optInt("segment", -1),
            markerCount = j.optInt("markerCount"),
            gpsLost = j.optBoolean("gpsLost"),
            monoOffset = j.optLong("monoOffset"),
            lastFix = fix(j.optJSONObject("lastFix")),
        )
    }

    /** The finished survey, as saved and exported. */
    fun finished(r: SurveyRecord, points: JSONArray): JSONObject {
        val end = r.stop?.mono ?: 0
        val pauses = JSONArray()
        r.pauses().forEach { p ->
            pauses.put(
                JSONObject().put("start", moment(p.start)).put("end", moment(p.end ?: r.stop))
                    .put("durationMs", p.durationMs(end)),
            )
        }
        val markers = JSONArray()
        r.events.filter { it.type == SurveyEventType.MARKER_ADDED }.forEach { markers.put(event(it)) }
        return JSONObject()
            .put("format", FORMAT).put("version", VERSION)
            .put("id", r.id).put("name", r.name).put("status", r.state.name)
            .put("startedAt", r.cameraStart?.utc ?: JSONObject.NULL)
            .put("completedAt", r.stop?.utc ?: JSONObject.NULL)
            .put("cameraRecordingStart", moment(r.cameraStart))
            .put("movementStart", moment(r.movementStart))
            .put("stop", moment(r.stop))
            .put("totalElapsedMs", r.totalElapsedMs(end))
            .put("surveyElapsedMs", r.surveyElapsedMs(end))
            .put("activeMovementMs", r.activeMovementMs(end))
            .put("pausedMs", r.pausedMs(end))
            .put("distance", r.distance)
            .put("pointCount", points.length())
            .put("markerCount", r.markerCount)
            .put(
                "clock",
                JSONObject()
                    .put("mono", "Android SystemClock.elapsedRealtime, ms")
                    .put("utc", "Unix time, ms, UTC, from the phone clock")
                    .put("gpsTime", "Location.time of each fix, ms (satellite time when provider is gps)")
                    .put("provider", "gps = satellites; fused / network = quick rough fix while GPS has none, check accuracy")
                    .put("bootCount", r.bootCount)
                    .put("monoOffsetMs", r.monoOffset)
                    .put("timeZone", TimeZone.getDefault().id),
            )
            .put("pauses", pauses)
            .put("markers", markers)
            .put("events", JSONArray().apply { r.events.forEach { put(event(it)) } })
            .put("points", points)
    }
}
