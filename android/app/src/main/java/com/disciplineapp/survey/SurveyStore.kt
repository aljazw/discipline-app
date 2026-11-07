package com.disciplineapp.survey

import android.content.Context
import com.disciplineapp.map.TrackStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Finished surveys, one JSON file each in files/surveys (format: [SurveyJson]),
 * plus index.json with their summaries so the list opens without reading points.
 */
object SurveyStore {

    private val SUMMARY_KEYS = listOf(
        "id", "name", "status", "startedAt", "completedAt", "totalElapsedMs", "surveyElapsedMs",
        "activeMovementMs", "pausedMs", "distance", "pointCount", "markerCount",
    )

    fun dir(context: Context) = File(context.filesDir, "surveys").apply { mkdirs() }
    private fun file(context: Context, id: String) = File(dir(context), "${id.replace(Regex("[^A-Za-z0-9_-]"), "")}.json")
    private fun indexFile(context: Context) = File(dir(context), "index.json")

    @Synchronized
    fun list(context: Context): JSONArray =
        runCatching { JSONArray(indexFile(context).readText()) }.getOrNull() ?: rebuildIndex(context)

    @Synchronized
    fun get(context: Context, id: String): JSONObject? =
        runCatching { JSONObject(file(context, id).readText()) }.getOrNull()

    /** Writes the survey and its index entry; throws if either can't be written. */
    @Synchronized
    fun save(context: Context, survey: JSONObject) {
        val id = survey.getString("id")
        val target = file(context, id)
        TrackStore.writeAtomic(target, survey.toString())
        // Read back, so "saved" means it is really on disk and parses.
        JSONObject(target.readText()).getString("id")
        writeIndex(context, without(list(context), id).put(summary(survey)))
    }

    @Synchronized
    fun delete(context: Context, id: String): Boolean {
        file(context, id).delete()
        writeIndex(context, without(list(context), id))
        return true
    }

    @Synchronized
    fun rename(context: Context, id: String, name: String): Boolean {
        val survey = get(context, id) ?: return false
        save(context, survey.put("name", name))
        return true
    }

    private fun without(index: JSONArray, id: String) = JSONArray().apply {
        for (i in 0 until index.length()) index.optJSONObject(i)?.takeIf { it.optString("id") != id }?.let(::put)
    }

    private fun summary(survey: JSONObject) = JSONObject().apply {
        SUMMARY_KEYS.forEach { key -> if (survey.has(key)) put(key, survey.get(key)) }
    }

    private fun writeIndex(context: Context, index: JSONArray) = TrackStore.writeAtomic(indexFile(context), index.toString())

    private fun rebuildIndex(context: Context): JSONArray {
        val index = JSONArray()
        dir(context).listFiles()?.filter { it.isFile && it.extension == "json" && it.name != "index.json" }?.forEach { f ->
            runCatching { JSONObject(f.readText()) }.getOrNull()
                ?.takeIf { it.optString("format") == SurveyJson.FORMAT }
                ?.let { index.put(summary(it)) }
        }
        runCatching { writeIndex(context, index) }
        return index
    }
}
