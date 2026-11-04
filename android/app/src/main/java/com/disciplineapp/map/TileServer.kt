package com.disciplineapp.map

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.util.LruCache
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URLDecoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

/**
 * A tiny HTTP server on 127.0.0.1 that serves MBTiles tiles to the map:
 * GET /<file id>/<z>/<x>/<y> → the tile, flipped from the map's XYZ rows to
 * MBTiles' TMS rows. Reading the SQLite file directly means a multi-gigabyte
 * chart opens instantly and needs no metadata. Gzipped vector tiles are sent
 * unpacked. A missing raster tile is made from a lower zoom level (see
 * [overzoom]); only where there's nothing at all is it a 404.
 */
object TileServer {
    private const val TAG = "TileServer"

    /** How many zoom levels up to look for a tile to scale up. */
    private const val MAX_OVERZOOM = 6

    private var socket: ServerSocket? = null
    /** Scaled-up tiles, so panning back and forth doesn't redo the work. */
    private val synthesized = object : LruCache<String, ByteArray>(16 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray) = value.size
    }
    private val pool = Executors.newFixedThreadPool(6)
    private val databases = ConcurrentHashMap<String, SQLiteDatabase>()
    private lateinit var appContext: Context

    /** Starts the server if needed and returns its base URL, e.g. "http://127.0.0.1:41234". */
    @Synchronized
    fun baseUrl(context: Context): String {
        appContext = context.applicationContext
        val running = socket?.takeIf { !it.isClosed } ?: ServerSocket(0, 50, InetAddress.getByName("127.0.0.1")).also {
            socket = it
            Thread({ accept(it) }, "tile-server").apply { isDaemon = true }.start()
        }
        return "http://127.0.0.1:${running.localPort}"
    }

    /** Closes a file's database, e.g. before it's deleted. */
    fun close(file: File) {
        databases.remove(file.name)?.close()
    }

    private fun accept(server: ServerSocket) {
        while (!server.isClosed) {
            try {
                val client = server.accept()
                pool.execute { serve(client) }
            } catch (e: Exception) {
                if (!server.isClosed) Log.w(TAG, "accept failed", e)
            }
        }
    }

    /** Answers requests on one connection until the client closes it (keep-alive). */
    private fun serve(client: Socket) {
        client.use { s -> serveConnection(s) }
    }

    private fun serveConnection(s: Socket) {
        s.soTimeout = 15_000
        val input = BufferedInputStream(s.getInputStream())
        val output = BufferedOutputStream(s.getOutputStream())
        try {
            while (true) {
                val requestLine = readLine(input) ?: return
                // Skip the headers; nothing in them changes the answer.
                while (true) {
                    val header = readLine(input) ?: return
                    if (header.isEmpty()) break
                }
                val path = requestLine.split(' ').getOrNull(1) ?: return
                val (status, type, body) = respond(path)
                output.write(
                    ("HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
                        "Cache-Control: no-store\r\nConnection: keep-alive\r\n\r\n").toByteArray(Charsets.US_ASCII),
                )
                output.write(body)
                output.flush()
            }
        } catch (_: SocketTimeoutException) {
        } catch (e: Exception) {
            Log.d(TAG, "connection ended: ${e.message}")
        }
    }

    private fun respond(rawPath: String): Triple<String, String, ByteArray> {
        val parts = rawPath.substringBefore('?').trim('/').split('/')
        if (parts.size != 4) return notFound()
        val id = URLDecoder.decode(parts[0], "UTF-8")
        val z = parts[1].toIntOrNull() ?: return notFound()
        val x = parts[2].toIntOrNull() ?: return notFound()
        val y = parts[3].substringBefore('.').toIntOrNull() ?: return notFound()
        val db = database(id) ?: return notFound()
        val data = readTile(db, z, x, y) ?: overzoom(id, db, z, x, y) ?: return notFound()
        return when (val format = MapFiles.sniff(data)) {
            "pbf" -> Triple("200 OK", "application/x-protobuf", unzip(data))
            "jpg" -> Triple("200 OK", "image/jpeg", data)
            else -> Triple("200 OK", "image/$format", data)
        }
    }

    /** One tile by XYZ address (MBTiles stores rows from the south, TMS). */
    private fun readTile(db: SQLiteDatabase, z: Int, x: Int, y: Int): ByteArray? = try {
        db.rawQuery(
            "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
            arrayOf(z.toString(), x.toString(), ((1 shl z) - 1 - y).toString()),
        ).use { c -> if (c.moveToFirst()) c.getBlob(0) else null }
    } catch (e: Exception) {
        Log.w(TAG, "tile read failed", e)
        null
    }

    /**
     * Charts are often detailed only in places: zoom 18 around a harbor, zoom 12
     * everywhere else. Where a raster tile is missing, cut its piece out of the
     * nearest lower-zoom tile and scale it up, so zooming in never goes blank.
     */
    private fun overzoom(id: String, db: SQLiteDatabase, z: Int, x: Int, y: Int): ByteArray? {
        val key = "$id/$z/$x/$y"
        synthesized.get(key)?.let { return it }
        for (up in 1..MAX_OVERZOOM) {
            val pz = z - up
            if (pz < 0) break
            val parent = readTile(db, pz, x shr up, y shr up) ?: continue
            if (MapFiles.sniff(parent) == "pbf") return null
            val bitmap = BitmapFactory.decodeByteArray(parent, 0, parent.size) ?: return null
            val size = bitmap.width shr up
            if (size < 1) return null
            val ox = (x - ((x shr up) shl up)) * size
            val oy = (y - ((y shr up) shl up)) * size
            val piece = Bitmap.createBitmap(bitmap, ox, oy, size, minOf(size, bitmap.height - oy))
            val scaled = Bitmap.createScaledBitmap(piece, bitmap.width, bitmap.height, true)
            val out = ByteArrayOutputStream()
            val jpeg = MapFiles.sniff(parent) == "jpg"
            scaled.compress(if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, 90, out)
            if (piece !== bitmap) piece.recycle()
            scaled.recycle()
            bitmap.recycle()
            return out.toByteArray().also { synthesized.put(key, it) }
        }
        return null
    }

    private fun database(id: String): SQLiteDatabase? = databases[id] ?: synchronized(databases) {
        databases[id] ?: MapFiles.find(appContext, id)
            ?.takeIf { it.extension.lowercase() == "mbtiles" }
            ?.let { runCatching { MapFiles.openMbtiles(it) }.getOrNull() }
            ?.also { databases[id] = it }
    }

    private fun unzip(data: ByteArray): ByteArray =
        if (data.size > 2 && data[0] == 0x1f.toByte() && data[1] == 0x8b.toByte()) {
            GZIPInputStream(data.inputStream()).use { it.readBytes() }
        } else {
            data
        }

    private fun notFound() = Triple("404 Not Found", "text/plain", ByteArray(0))

    /** One CRLF-terminated line, or null at the end of the stream. */
    private fun readLine(input: InputStream): String? {
        val line = StringBuilder()
        while (true) {
            val c = input.read()
            if (c == -1) return if (line.isEmpty()) null else line.toString()
            if (c == '\n'.code) return line.toString().trimEnd('\r')
            if (line.length > 8192) return null
            line.append(c.toChar())
        }
    }
}
