package com.disciplineapp.music

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.disciplineapp.MainActivity
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Plays the user's music. A Media3 session service, so playback keeps going
 * with the app in the background or closed, and the system shows the
 * notification, lock-screen and headset controls. Training cues are plain
 * tones mixed over the top, so music keeps playing through workouts and apnea.
 *
 * Also runs the sleep timer, here rather than in JS so it still stops the music
 * with the app closed. Its state reaches the app through the session extras.
 */
class MusicService : MediaSessionService() {

    private var session: MediaSession? = null
    private val main = Handler(Looper.getMainLooper())

    /** When the sleep timer stops the music (elapsedRealtime); 0 = no timed stop. */
    private var sleepAt = 0L
    private var sleepEndOfSong = false
    private val sleepTick = Runnable { tickSleep() }

    private val playerListener = object : Player.Listener {
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            // "End of this song" did its job.
            if (sleepEndOfSong && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) clearSleep()
        }

        override fun onEvents(player: Player, events: Player.Events) {
            // Stopped and cleared: nothing left to stop.
            if (player.mediaItemCount == 0 && (sleepAt > 0 || sleepEndOfSong)) clearSleep()
        }
    }

    private val callback = object : MediaSession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            // Close is for everyone (notification, lock screen); only the app itself may set the sleep timer.
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .add(SessionCommand(CLOSE_COMMAND, Bundle.EMPTY))
                .apply { if (controller.packageName == packageName) add(SessionCommand(SLEEP_COMMAND, Bundle.EMPTY)) }
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands)
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                SLEEP_COMMAND -> setSleep(args.getInt(SLEEP_MINUTES), args.getBoolean(SLEEP_END_OF_SONG))
                CLOSE_COMMAND -> close()
                else -> return super.onCustomCommand(session, controller, customCommand, args)
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }

    override fun onCreate() {
        super.onCreate()
        val attributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()
        val player = ExoPlayer.Builder(this)
            // Pauses for calls and other players; resumes after.
            .setAudioAttributes(attributes, true)
            // Pauses when headphones are unplugged.
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()
        player.addListener(playerListener)
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaSession.Builder(this, player)
            .setSessionActivity(openApp)
            .setCallback(callback)
            .setMediaButtonPreferences(listOf(closeButton))
            .build()
    }

    /** The notification's close button: stops the music and takes the notification away. */
    private val closeButton = CommandButton.Builder(CommandButton.ICON_STOP)
        .setDisplayName("Close")
        .setSessionCommand(SessionCommand(CLOSE_COMMAND, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
        .build()

    private fun close() {
        val player = session?.player ?: return
        clearSleep()
        player.stop()
        player.clearMediaItems()
        stopSelf()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Swiping the app away keeps the music going; with nothing playing the service goes too. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    /** Stop after `minutes` (0 = no timed stop), or at the end of the playing song. */
    private fun setSleep(minutes: Int, endOfSong: Boolean) {
        val player = session?.player as? ExoPlayer ?: return
        main.removeCallbacks(sleepTick)
        player.volume = 1f
        sleepEndOfSong = endOfSong
        player.pauseAtEndOfMediaItems = endOfSong
        sleepAt = if (minutes > 0) SystemClock.elapsedRealtime() + minutes * 60_000L else 0L
        if (sleepAt > 0) main.post(sleepTick)
        publishSleep()
    }

    private fun clearSleep() = setSleep(0, false)

    /** Waits until the last stretch, then fades the volume down to the stop so it doesn't wake anyone. */
    private fun tickSleep() {
        val player = session?.player ?: return
        val left = sleepAt - SystemClock.elapsedRealtime()
        if (left <= 0) {
            player.pause()
            clearSleep()
            return
        }
        player.volume = (left.toFloat() / SLEEP_FADE_MS).coerceAtMost(1f)
        main.postDelayed(sleepTick, if (left > SLEEP_FADE_MS) left - SLEEP_FADE_MS else 250L)
    }

    private fun publishSleep() {
        val endsAt = if (sleepAt > 0) System.currentTimeMillis() + (sleepAt - SystemClock.elapsedRealtime()) else 0L
        session?.setSessionExtras(
            Bundle().apply {
                putLong(SLEEP_ENDS_AT, endsAt)
                putBoolean(SLEEP_END_OF_SONG, sleepEndOfSong)
            },
        )
    }

    override fun onDestroy() {
        main.removeCallbacks(sleepTick)
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    companion object {
        const val SLEEP_COMMAND = "com.disciplineapp.music.SLEEP"
        const val CLOSE_COMMAND = "com.disciplineapp.music.CLOSE"
        const val SLEEP_MINUTES = "minutes"
        const val SLEEP_END_OF_SONG = "endOfSong"
        /** Epoch millis of the timed stop; 0 = none. */
        const val SLEEP_ENDS_AT = "endsAt"
        private const val SLEEP_FADE_MS = 30_000L
    }
}
