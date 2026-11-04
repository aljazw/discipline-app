package com.disciplineapp.map

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.sinh

/**
 * Offline map files on the phone. They live in the app's external files
 * folder (Android/data/<app>/files/maps), so a big chart can also be copied
 * there over USB instead of through the in-app import, and it shows up on
 * the next refresh.
 *
 * Supported: MBTiles (raster PNG/JPEG/WebP or vector PBF) and PMTiles v3.
 * Each file gets a small "<file>.json" next to it with what was read from it
 * (format, zoom range, bounds), so the list opens without reading every map.
 */
object MapFiles {

    val EXTENSIONS = listOf("mbtiles", "pmtiles")

    fun dir(context: Context): File {
        val base = context.getExternalFilesDir(null) ?: context.filesDir
        return File(base, "maps").apply { mkdirs() }
    }

    /** The map files, each with its info; reads and caches info for new files. */
    fun list(context: Context): JSONArray {
        val result = JSONArray()
        dir(context).listFiles()
            ?.filter { it.isFile && it.extension.lowercase() in EXTENSIONS }
            ?.sortedBy { it.name.lowercase() }
            ?.forEach { file -> runCatching { info(file) }.getOrNull()?.let(result::put) }
        return result
    }

    fun find(context: Context, id: String): File? =
        dir(context).listFiles()?.firstOrNull { it.isFile && it.name == id }

    fun remove(context: Context, id: String): Boolean {
        val file = find(context, id) ?: return false
        TileServer.close(file)
        sidecar(file).delete()
        return file.delete()
    }

    fun rename(context: Context, id: String, name: String): Boolean {
        val file = find(context, id) ?: return false
        val info = info(file).put("name", name.trim().ifEmpty { file.nameWithoutExtension })
        sidecar(file).writeText(info.toString())
        return true
    }

    /** A free file name in the maps folder for an imported file. */
    fun target(context: Context, displayName: String): File {
        val clean = displayName.replace(Regex("[^A-Za-z0-9._ -]"), "_").ifBlank { "map.mbtiles" }
        val ext = clean.substringAfterLast('.', "").lowercase()
        val stem = clean.substringBeforeLast('.')
        val folder = dir(context)
        var file = File(folder, "$stem.$ext")
        var n = 2
        while (file.exists()) file = File(folder, "$stem ($n).$ext").also { n++ }
        return file
    }

    private fun sidecar(file: File) = File(file.parentFile, "${file.name}.json")

    /** Info for one map file, from its sidecar when the file is unchanged since. */
    fun info(file: File): JSONObject {
        val side = sidecar(file)
        if (side.exists()) {
            runCatching { JSONObject(side.readText()) }.getOrNull()
                ?.takeIf { it.optLong("size") == file.length() }
                ?.let { return it }
        }
        val info = when (file.extension.lowercase()) {
            "pmtiles" -> readPmtiles(file)
            else -> readMbtiles(file)
        }
        info.put("id", file.name)
            .put("path", file.absolutePath)
            .put("size", file.length())
            .put("kind", file.extension.lowercase())
        if (!info.has("name") || info.optString("name").isBlank()) info.put("name", file.nameWithoutExtension)
        runCatching { side.writeText(info.toString()) }
        return info
    }

    // ---- MBTiles ------------------------------------------------------------

    fun openMbtiles(file: File): SQLiteDatabase = SQLiteDatabase.openDatabase(
        file.absolutePath,
        null,
        SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS,
    )

    private fun readMbtiles(file: File): JSONObject = openMbtiles(file).use { db ->
        val meta = HashMap<String, String>()
        runCatching {
            db.rawQuery("SELECT name, value FROM metadata", null).use { c ->
                while (c.moveToNext()) meta[c.getString(0).lowercase()] = c.getString(1) ?: ""
            }
        }
        val info = JSONObject()
        meta["name"]?.let { info.put("name", it) }
        meta["attribution"]?.let { info.put("attribution", it) }

        var minZoom = meta["minzoom"]?.toIntOrNull()
        var maxZoom = meta["maxzoom"]?.toIntOrNull()
        if (minZoom == null || maxZoom == null) {
            db.rawQuery("SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles", null).use { c ->
                if (c.moveToFirst() && !c.isNull(0)) {
                    minZoom = c.getInt(0)
                    maxZoom = c.getInt(1)
                }
            }
        }
        info.put("minZoom", minZoom ?: 0).put("maxZoom", maxZoom ?: 18)

        var format = meta["format"]?.lowercase()?.let { if (it == "jpeg") "jpg" else it }
        if (format == null) {
            db.rawQuery("SELECT tile_data FROM tiles LIMIT 1", null).use { c ->
                if (c.moveToFirst()) format = sniff(c.getBlob(0))
            }
        }
        info.put("format", format ?: "png")
        info.put("type", if (format == "pbf" || format == "mvt") "vector" else "raster")

        val bounds = meta["bounds"]?.split(',')?.mapNotNull { it.trim().toDoubleOrNull() }
        if (bounds != null && bounds.size == 4) {
            info.put("bounds", JSONArray(bounds))
        } else {
            boundsFromTiles(db, minZoom ?: 0)?.let { info.put("bounds", it) }
        }
        // Vector tiles name their layers in "json"; the generic style draws each one.
        meta["json"]?.let { raw ->
            runCatching { JSONObject(raw).optJSONArray("vector_layers") }.getOrNull()?.let {
                info.put("layers", layerNames(it))
            }
        }
        info
    }

    /** West, south, east, north of the tiles at one zoom level (MBTiles rows count from the south). */
    private fun boundsFromTiles(db: SQLiteDatabase, zoom: Int): JSONArray? =
        db.rawQuery(
            "SELECT MIN(tile_column), MAX(tile_column), MIN(tile_row), MAX(tile_row) FROM tiles WHERE zoom_level = ?",
            arrayOf(zoom.toString()),
        ).use { c ->
            if (!c.moveToFirst() || c.isNull(0)) return null
            val n = 1 shl zoom
            val west = c.getInt(0).toDouble() / n * 360 - 180
            val east = (c.getInt(1) + 1).toDouble() / n * 360 - 180
            val north = tileLat(n - 1 - c.getInt(3), n)
            val south = tileLat(n - c.getInt(2), n)
            JSONArray(listOf(west, south, east, north))
        }

    private fun tileLat(y: Int, n: Int) = Math.toDegrees(atan(sinh(PI * (1 - 2.0 * y / n))))

    /** The tile format from its first bytes. */
    fun sniff(data: ByteArray?): String {
        if (data == null || data.size < 4) return "png"
        return when {
            data[0] == 0x89.toByte() && data[1] == 'P'.code.toByte() -> "png"
            data[0] == 0xFF.toByte() && data[1] == 0xD8.toByte() -> "jpg"
            data[0] == 'R'.code.toByte() && data[1] == 'I'.code.toByte() -> "webp"
            else -> "pbf" // gzipped or raw protobuf
        }
    }

    private fun layerNames(layers: JSONArray) = JSONArray().apply {
        for (i in 0 until layers.length()) layers.optJSONObject(i)?.optString("id")?.takeIf { it.isNotEmpty() }?.let(::put)
    }

    // ---- PMTiles (v3 header, 127 bytes) ---------------------------------------

    private fun readPmtiles(file: File): JSONObject = RandomAccessFile(file, "r").use { raf ->
        val header = ByteArray(127)
        raf.readFully(header)
        if (String(header, 0, 7, Charsets.US_ASCII) != "PMTiles" || header[7].toInt() != 3) {
            throw IllegalArgumentException("Only PMTiles version 3 is supported.")
        }
        val b = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        val tileType = header[99].toInt()
        val format = when (tileType) { 1 -> "pbf"; 2 -> "png"; 3 -> "jpg"; 4 -> "webp"; 5 -> "avif"; else -> "png" }
        val e7 = { offset: Int -> b.getInt(offset) / 10_000_000.0 }
        val info = JSONObject()
            .put("format", format)
            .put("type", if (tileType == 1) "vector" else "raster")
            .put("minZoom", header[100].toInt() and 0xFF)
            .put("maxZoom", header[101].toInt() and 0xFF)
            .put("bounds", JSONArray(listOf(e7(102), e7(106), e7(110), e7(114))))

        // JSON metadata: the name and, for vector tiles, the layer names.
        val metaOffset = b.getLong(24)
        val metaLength = b.getLong(32)
        if (metaLength in 1..MAX_METADATA) {
            val bytes = ByteArray(metaLength.toInt())
            raf.seek(metaOffset)
            raf.readFully(bytes)
            val text = runCatching {
                if (header[97].toInt() == 2) GZIPInputStream(bytes.inputStream()).readBytes().toString(Charsets.UTF_8)
                else bytes.toString(Charsets.UTF_8)
            }.getOrNull()
            text?.let { runCatching { JSONObject(it) }.getOrNull() }?.let { meta ->
                meta.optString("name").takeIf { it.isNotBlank() }?.let { info.put("name", it) }
                meta.optString("attribution").takeIf { it.isNotBlank() }?.let { info.put("attribution", it) }
                meta.optJSONArray("vector_layers")?.let { info.put("layers", layerNames(it)) }
            }
        }
        info
    }

    private const val MAX_METADATA = 4L * 1024 * 1024
}
