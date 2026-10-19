package com.disciplineapp.music

import android.content.ComponentName
import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executor

/**
 * JS bridge for [MusicService]: lists the songs on the phone and drives the
 * player through a Media3 controller. State goes to JS as a JSON string in a
 * "MusicState" event on every change; JS moves the position along between them.
 */
class MusicModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    override fun getName(): String = "Music"

    private val main = Handler(Looper.getMainLooper())
    private val mainExecutor = Executor { main.post(it) }
    private var controller: ListenableFuture<MediaController>? = null

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = emit(player)
    }

    /** The sleep timer changes through the session extras, not the player. */
    private val controllerListener = object : MediaController.Listener {
        override fun onExtrasChanged(controller: MediaController, extras: Bundle) = emit(controller)

        /** The service stopped (closed from the notification): connect afresh on the next call. */
        override fun onDisconnected(controller: MediaController) {
            val future = this@MusicModule.controller
            if (future != null && future.isDone && runCatching { future.get() }.getOrNull() === controller) {
                this@MusicModule.controller = null
            }
            controller.release()
        }
    }

    /**
     * Every audio file on the phone, by title, with its folder and whether Android
     * counts it as music. Runs off the main thread; large libraries take a moment.
     */
    @ReactMethod
    fun getLibrary(promise: Promise) {
        Thread {
            try {
                promise.resolve(queryLibrary().toString())
            } catch (e: SecurityException) {
                promise.reject("music_permission", e.message, e)
            } catch (e: Exception) {
                promise.reject("music_error", e.message, e)
            }
        }.start()
    }

    /** Plays `tracksJson` (from [getLibrary]) as the queue, starting at `index`. */
    @ReactMethod
    fun play(tracksJson: String, index: Int, shuffle: Boolean, promise: Promise) = withPlayer(promise) {
        val tracks = JSONArray(tracksJson)
        val items = (0 until tracks.length()).map { toMediaItem(tracks.getJSONObject(it)) }
        it.shuffleModeEnabled = shuffle
        it.setMediaItems(items, index.coerceIn(0, maxOf(0, items.size - 1)), 0)
        it.prepare()
        it.play()
    }

    @ReactMethod
    fun toggle(promise: Promise) = withPlayer(promise) {
        if (it.isPlaying) {
            it.pause()
        } else {
            if (it.playbackState == Player.STATE_ENDED) it.seekToDefaultPosition(0)
            if (it.playbackState == Player.STATE_IDLE) it.prepare()
            it.play()
        }
    }

    @ReactMethod
    fun next(promise: Promise) = withPlayer(promise) { it.seekToNext() }

    /** Back to the start of the song, or the song before when it has just started. */
    @ReactMethod
    fun previous(promise: Promise) = withPlayer(promise) { it.seekToPrevious() }

    @ReactMethod
    fun seekTo(positionMs: Double, promise: Promise) = withPlayer(promise) { it.seekTo(positionMs.toLong()) }

    @ReactMethod
    fun setShuffle(enabled: Boolean, promise: Promise) = withPlayer(promise) { it.shuffleModeEnabled = enabled }

    /** "off", "all" or "one". */
    @ReactMethod
    fun setRepeat(mode: String, promise: Promise) = withPlayer(promise) {
        it.repeatMode = when (mode) {
            "all" -> Player.REPEAT_MODE_ALL
            "one" -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }

    /** Stop after `minutes` (0 = no timed stop), or with `endOfSong` when the playing song ends. */
    @ReactMethod
    fun setSleepTimer(minutes: Double, endOfSong: Boolean, promise: Promise) = withPlayer(promise) {
        val args = Bundle().apply {
            putInt(MusicService.SLEEP_MINUTES, minutes.toInt())
            putBoolean(MusicService.SLEEP_END_OF_SONG, endOfSong)
        }
        it.sendCustomCommand(SessionCommand(MusicService.SLEEP_COMMAND, Bundle.EMPTY), args)
    }

    /** Stops and clears the queue, which also removes the notification. */
    @ReactMethod
    fun stop(promise: Promise) = withPlayer(promise) {
        it.stop()
        it.clearMediaItems()
    }

    @ReactMethod
    fun getState(promise: Promise) = withPlayer(promise) { }

    // NativeEventEmitter needs these two.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    override fun invalidate() {
        val future = controller
        controller = null
        main.post {
            future?.let { f ->
                if (f.isDone) runCatching { f.get().run { removeListener(listener); release() } }
                else f.cancel(true)
            }
        }
        super.invalidate()
    }

    /** Runs `block` on the main thread with a connected controller, then resolves with the state. */
    private fun withPlayer(promise: Promise, block: (MediaController) -> Unit) {
        main.post {
            val future = controller ?: MediaController.Builder(
                ctx,
                SessionToken(ctx, ComponentName(ctx, MusicService::class.java)),
            ).setListener(controllerListener).buildAsync().also { f ->
                controller = f
                f.addListener({ runCatching { f.get().addListener(listener) } }, mainExecutor)
            }
            future.addListener({
                try {
                    val player = future.get()
                    block(player)
                    promise.resolve(state(player).toString())
                } catch (e: Exception) {
                    // A dead connection is rebuilt on the next call.
                    if (controller === future) controller = null
                    promise.reject("music_error", e.message, e)
                }
            }, mainExecutor)
        }
    }

    private fun emit(player: Player) {
        if (ctx.hasActiveReactInstance()) {
            ctx.emitDeviceEvent("MusicState", state(player).toString())
        }
    }

    private fun state(player: Player): JSONObject {
        val item = player.currentMediaItem
        val meta = item?.mediaMetadata
        return JSONObject().apply {
            put("trackId", item?.mediaId ?: "")
            put("title", meta?.title?.toString() ?: "")
            put("artist", meta?.artist?.toString() ?: "")
            put("playing", player.isPlaying)
            // Playing, or about to (buffering); the button shows pause either way.
            put("playWhenReady", player.playWhenReady && player.playbackState != Player.STATE_ENDED)
            put("positionMs", player.currentPosition)
            put("durationMs", player.duration.takeIf { it > 0 } ?: 0L)
            put("index", player.currentMediaItemIndex)
            put("count", player.mediaItemCount)
            put("shuffle", player.shuffleModeEnabled)
            put(
                "repeat",
                when (player.repeatMode) {
                    Player.REPEAT_MODE_ALL -> "all"
                    Player.REPEAT_MODE_ONE -> "one"
                    else -> "off"
                },
            )
            val extras = (player as? MediaController)?.sessionExtras
            put("sleepAt", extras?.getLong(MusicService.SLEEP_ENDS_AT) ?: 0L)
            put("sleepEndOfSong", extras?.getBoolean(MusicService.SLEEP_END_OF_SONG) ?: false)
            put("at", System.currentTimeMillis())
        }
    }

    private fun toMediaItem(track: JSONObject): MediaItem {
        val albumId = track.optLong("albumId", -1)
        val meta = MediaMetadata.Builder()
            .setTitle(track.optString("title"))
            .setArtist(track.optString("artist"))
            .setAlbumTitle(track.optString("album"))
            .apply {
                if (albumId >= 0) setArtworkUri(ContentUris.withAppendedId(ALBUM_ART, albumId))
            }
            .build()
        return MediaItem.Builder()
            .setMediaId(track.getString("id"))
            .setUri(track.getString("uri"))
            .setMediaMetadata(meta)
            .build()
    }

    private fun queryLibrary(): JSONArray {
        val songs = JSONArray()
        val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        // RELATIVE_PATH ("Music/Gym/") exists from Android 10; before that the folder comes from the file path.
        val folderColumn =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.Audio.Media.RELATIVE_PATH
            else @Suppress("DEPRECATION") MediaStore.Audio.Media.DATA
        val columns = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.IS_MUSIC,
            folderColumn,
        )
        ctx.contentResolver.query(collection, columns, null, null, "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE")
            ?.use { c ->
                val id = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val title = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val album = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val albumId = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                val duration = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val isMusic = c.getColumnIndexOrThrow(MediaStore.Audio.Media.IS_MUSIC)
                val folder = c.getColumnIndexOrThrow(folderColumn)
                while (c.moveToNext()) {
                    val songId = c.getLong(id)
                    songs.put(
                        JSONObject()
                            .put("id", songId.toString())
                            .put("uri", ContentUris.withAppendedId(collection, songId).toString())
                            .put("title", c.getString(title) ?: "")
                            .put("artist", c.getString(artist)?.takeUnless { it == MediaStore.UNKNOWN_STRING } ?: "")
                            .put("album", c.getString(album) ?: "")
                            .put("albumId", c.getLong(albumId))
                            .put("durationMs", c.getLong(duration))
                            // Ringtones, notification sounds and voice notes aren't music.
                            .put("music", c.getInt(isMusic) != 0)
                            .put("folder", toFolder(c.getString(folder))),
                    )
                }
            }
        return songs
    }

    /** "Music/Gym/" style folder, from RELATIVE_PATH as is or from a full file path. */
    private fun toFolder(value: String?): String {
        if (value.isNullOrEmpty()) return ""
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return value
        val dir = value.substringBeforeLast('/', "")
        @Suppress("DEPRECATION")
        val root = Environment.getExternalStorageDirectory().path
        val relative = if (dir == root) "" else if (dir.startsWith("$root/")) dir.removePrefix("$root/") else dir.trimStart('/')
        return if (relative.isEmpty()) "" else "$relative/"
    }

    private companion object {
        val ALBUM_ART: Uri = Uri.parse("content://media/external/audio/albumart")
    }
}
