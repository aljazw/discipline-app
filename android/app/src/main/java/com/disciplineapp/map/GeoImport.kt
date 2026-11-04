package com.disciplineapp.map

import android.util.Xml
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader
import java.time.Instant

/**
 * Reads GPX, KML and GeoJSON into one shape the app understands:
 *   { marks: [{name, lat, lon, note}], routes: [{name, points: [[lat, lon]]}],
 *     tracks: [{name, points: [[lat, lon, alt, time]]}] }
 * GPX waypoints / KML and GeoJSON points become marks, GPX routes become
 * routes, GPX tracks and every line string become tracks.
 */
object GeoImport {

    fun parse(text: String, fileName: String): JSONObject {
        val trimmed = text.trimStart('﻿', ' ', '\n', '\r', '\t')
        val ext = fileName.substringAfterLast('.', "").lowercase()
        val result = when {
            trimmed.startsWith("{") || ext == "geojson" || ext == "json" -> geoJson(JSONObject(trimmed))
            ext == "kml" || trimmed.contains("<kml", ignoreCase = true) -> xml(trimmed, kml = true)
            else -> xml(trimmed, kml = false)
        }
        val count = listOf("marks", "routes", "tracks").sumOf { result.getJSONArray(it).length() }
        if (count == 0) throw IllegalArgumentException("No places, routes or tracks found in that file.")
        return result
    }

    private fun empty() = JSONObject().put("marks", JSONArray()).put("routes", JSONArray()).put("tracks", JSONArray())

    // ---- GPX and KML ----------------------------------------------------------

    private fun xml(text: String, kml: Boolean): JSONObject {
        val out = empty()
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(StringReader(text))

        // The element being read: a GPX wpt/rte/trk or a KML Placemark.
        var feature: String? = null
        /** Depth of the feature element; its own name and description are its direct children. */
        var featureDepth = 0
        var name = ""
        var note = ""
        var point: DoubleArray? = null
        var time: Long? = null
        val points = JSONArray()
        val lines = mutableListOf<JSONArray>()
        var current: JSONArray? = null
        var text0 = StringBuilder()

        fun reset() {
            name = ""; note = ""; point = null; time = null
            lines.clear(); current = null
            while (points.length() > 0) points.remove(0)
        }

        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
            val tag = parser.name?.substringAfter(':')?.lowercase()
            when (parser.eventType) {
                XmlPullParser.START_TAG -> {
                    text0 = StringBuilder()
                    when {
                        !kml && tag in setOf("wpt", "rte", "trk") && feature == null -> {
                            feature = tag; featureDepth = parser.depth; reset()
                            if (tag == "wpt") point = latLon(parser)
                        }
                        kml && tag == "placemark" -> { feature = "placemark"; featureDepth = parser.depth; reset() }
                        !kml && (tag == "rtept" || tag == "trkpt") -> { point = latLon(parser); time = null }
                        !kml && tag == "trkseg" -> current = JSONArray().also(lines::add)
                    }
                }
                XmlPullParser.TEXT -> text0.append(parser.text)
                XmlPullParser.END_TAG -> {
                    val value = text0.toString().trim()
                    when {
                        feature != null && parser.depth == featureDepth + 1 && tag == "name" -> name = value
                        feature != null && parser.depth == featureDepth + 1 && note.isEmpty() &&
                            (tag == "desc" || tag == "cmt" || tag == "description") -> note = value
                        tag == "time" -> time = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
                        tag == "ele" -> point?.let { if (it.size > 2) it[2] = value.toDoubleOrNull() ?: 0.0 }
                        !kml && tag == "rtept" -> point?.let { points.put(JSONArray(listOf(it[0], it[1]))) }
                        !kml && tag == "trkpt" -> point?.let { p ->
                            val target = current ?: JSONArray().also { lines.add(it); current = it }
                            target.put(JSONArray(listOf(p[0], p[1], p[2], time ?: 0L)))
                        }
                        kml && tag == "coordinates" -> {
                            val coords = value.split(Regex("\\s+")).mapNotNull { c ->
                                val n = c.split(',').mapNotNull { it.toDoubleOrNull() }
                                if (n.size >= 2) doubleArrayOf(n[1], n[0], n.getOrElse(2) { 0.0 }) else null
                            }
                            if (coords.size == 1) point = coords[0]
                            else if (coords.size > 1) lines.add(JSONArray().apply {
                                coords.forEach { put(JSONArray(listOf(it[0], it[1], it[2], 0L))) }
                            })
                        }
                        tag == feature || (kml && tag == "placemark") -> {
                            val label = name.ifEmpty { null }
                            when (feature) {
                                "wpt" -> point?.let { addMark(out, label, it, note) }
                                "rte" -> if (points.length() > 1) out.getJSONArray("routes").put(
                                    JSONObject().put("name", label ?: "Route").put("points", JSONArray(points.toString())),
                                )
                                "trk" -> addTrack(out, label, lines)
                                "placemark" -> {
                                    if (lines.isNotEmpty()) addTrack(out, label, lines)
                                    else point?.let { addMark(out, label, it, note) }
                                }
                            }
                            feature = null
                        }
                    }
                    text0 = StringBuilder()
                }
            }
            parser.next()
        }
        return out
    }

    private fun latLon(parser: XmlPullParser): DoubleArray? {
        val lat = parser.getAttributeValue(null, "lat")?.toDoubleOrNull()
        val lon = parser.getAttributeValue(null, "lon")?.toDoubleOrNull()
        return if (lat != null && lon != null) doubleArrayOf(lat, lon, 0.0) else null
    }

    private fun addMark(out: JSONObject, name: String?, p: DoubleArray, note: String) {
        out.getJSONArray("marks").put(
            JSONObject().put("name", name ?: "Mark").put("lat", p[0]).put("lon", p[1]).put("note", note),
        )
    }

    /** All segments of a track joined into one line. */
    private fun addTrack(out: JSONObject, name: String?, lines: List<JSONArray>) {
        val joined = JSONArray()
        lines.forEach { line -> for (i in 0 until line.length()) joined.put(line.get(i)) }
        if (joined.length() > 1) out.getJSONArray("tracks").put(JSONObject().put("name", name ?: "Track").put("points", joined))
    }

    // ---- GeoJSON ------------------------------------------------------------

    private fun geoJson(root: JSONObject): JSONObject {
        val out = empty()
        val features = when (root.optString("type")) {
            "FeatureCollection" -> root.optJSONArray("features") ?: JSONArray()
            "Feature" -> JSONArray().put(root)
            else -> JSONArray().put(JSONObject().put("type", "Feature").put("geometry", root))
        }
        for (i in 0 until features.length()) {
            val f = features.optJSONObject(i) ?: continue
            val props = f.optJSONObject("properties")
            val name = props?.optString("name")?.takeIf { it.isNotBlank() } ?: props?.optString("title")?.takeIf { it.isNotBlank() }
            val note = props?.optString("description") ?: ""
            geometry(out, f.optJSONObject("geometry") ?: continue, name, note)
        }
        return out
    }

    private fun geometry(out: JSONObject, g: JSONObject, name: String?, note: String) {
        val coords = g.optJSONArray("coordinates")
        when (g.optString("type")) {
            "Point" -> coords?.let { position(it) }?.let { addMark(out, name, it, note) }
            "MultiPoint" -> coords?.let { for (i in 0 until it.length()) position(it.getJSONArray(i))?.let { p -> addMark(out, name, p, note) } }
            "LineString" -> coords?.let { addTrack(out, name, listOf(line(it))) }
            "MultiLineString", "Polygon" -> coords?.let { c -> addTrack(out, name, (0 until c.length()).map { line(c.getJSONArray(it)) }) }
            "GeometryCollection" -> g.optJSONArray("geometries")?.let { gs ->
                for (i in 0 until gs.length()) gs.optJSONObject(i)?.let { geometry(out, it, name, note) }
            }
        }
    }

    private fun position(a: JSONArray): DoubleArray? =
        if (a.length() >= 2) doubleArrayOf(a.getDouble(1), a.getDouble(0), a.optDouble(2, 0.0)) else null

    private fun line(a: JSONArray) = JSONArray().apply {
        for (i in 0 until a.length()) position(a.getJSONArray(i))?.let { put(JSONArray(listOf(it[0], it[1], it[2], 0L))) }
    }
}
