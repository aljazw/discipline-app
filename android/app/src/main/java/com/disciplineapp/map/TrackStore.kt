package com.disciplineapp.map

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Saved tracks, one JSON file each in files/tracks, plus index.json with
 * every track's summary so the list opens without reading the points.
 *
 * A track file: {id, name, startedAt, endedAt, distance (m), movingMs,
 * maxSpeed (m/s), points: [[lat, lon, alt, time, speed], ...]}.
 */
object TrackStore {

    private fun dir(context: Context) = File(context.filesDir, "tracks").apply { mkdirs() }
    private fun file(context: Context, id: String) = File(dir(context), "${id.replace(Regex("[^A-Za-z0-9_-]"), "")}.json")
    private fun indexFile(context: Context) = File(dir(context), "index.json")

    @Synchronized
    fun list(context: Context): JSONArray =
        runCatching { JSONArray(indexFile(context).readText()) }.getOrNull() ?: rebuildIndex(context)

    @Synchronized
    fun get(context: Context, id: String): JSONObject? =
        runCatching { JSONObject(file(context, id).readText()) }.getOrNull()

    /** Saves a whole track (recorded or imported) and updates the index. */
    @Synchronized
    fun save(context: Context, track: JSONObject) {
        val id = track.getString("id")
        writeAtomic(file(context, id), track.toString())
        val index = list(context)
        val summary = summary(track)
        val kept = JSONArray()
        for (i in 0 until index.length()) index.optJSONObject(i)?.takeIf { it.optString("id") != id }?.let(kept::put)
        kept.put(summary)
        writeAtomic(indexFile(context), kept.toString())
    }

    @Synchronized
    fun delete(context: Context, id: String): Boolean {
        file(context, id).delete()
        val index = list(context)
        val kept = JSONArray()
        for (i in 0 until index.length()) index.optJSONObject(i)?.takeIf { it.optString("id") != id }?.let(kept::put)
        writeAtomic(indexFile(context), kept.toString())
        return true
    }

    @Synchronized
    fun rename(context: Context, id: String, name: String): Boolean {
        val track = get(context, id) ?: return false
        save(context, track.put("name", name))
        return true
    }

    private fun summary(track: JSONObject) = JSONObject().apply {
        listOf("id", "name", "startedAt", "endedAt", "distance", "movingMs", "maxSpeed").forEach { key ->
            if (track.has(key)) put(key, track.get(key))
        }
        val points = track.optJSONArray("points")
        put("pointCount", points?.length() ?: 0)
        // A light outline for drawing every track on the map at once.
        if (points != null) put("preview", simplify(points, PREVIEW_POINTS))
    }

    /** Every n-th point, so long tracks stay cheap to draw in overview. */
    private fun simplify(points: JSONArray, max: Int): JSONArray {
        val step = maxOf(1, points.length() / max)
        val out = JSONArray()
        var i = 0
        while (i < points.length()) {
            val p = points.getJSONArray(i)
            out.put(JSONArray(listOf(p.getDouble(0), p.getDouble(1))))
            i += step
        }
        if (points.length() > 0 && (points.length() - 1) % step != 0) {
            val last = points.getJSONArray(points.length() - 1)
            out.put(JSONArray(listOf(last.getDouble(0), last.getDouble(1))))
        }
        return out
    }

    private fun rebuildIndex(context: Context): JSONArray {
        val index = JSONArray()
        dir(context).listFiles()?.filter { it.name != "index.json" && it.extension == "json" }?.forEach { f ->
            runCatching { JSONObject(f.readText()) }.getOrNull()?.let { index.put(summary(it)) }
        }
        runCatching { writeAtomic(indexFile(context), index.toString()) }
        return index
    }

    fun writeAtomic(target: File, text: String) {
        val tmp = File(target.parentFile, "${target.name}.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(target)) {
            target.writeText(text)
            tmp.delete()
        }
    }

    private const val PREVIEW_POINTS = 400
}
