package com.disciplineapp.video

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.VideoView
import com.disciplineapp.AppScreen
import com.disciplineapp.R

/**
 * Plays the "keep your word" video before planning tomorrow: a plan is a
 * promise to yourself. No controls and no way past it but watching; closes
 * by itself when it ends (or if the player fails).
 */
class PromiseVideoActivity : Activity() {

    private var video: VideoView? = null
    private var position = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        position = savedInstanceState?.getInt(KEY_POSITION) ?: 0

        val player = VideoView(this).apply {
            setVideoURI(Uri.parse("android.resource://$packageName/${R.raw.keep_your_word}"))
            setOnCompletionListener {
                setResult(RESULT_OK)
                finish()
            }
            // A broken player must not leave the user stuck on a black screen.
            setOnErrorListener { _, _, _ ->
                setResult(RESULT_OK)
                finish()
                true
            }
        }
        video = player

        setContentView(FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(player, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ))
        })
        AppScreen.paintSystemBars(this, Color.BLACK, dark = true)
    }

    override fun onPause() {
        super.onPause()
        video?.let {
            position = it.currentPosition
            it.pause()
        }
    }

    override fun onResume() {
        super.onResume()
        video?.let {
            it.seekTo(position)
            it.start()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(KEY_POSITION, position)
    }

    override fun onDestroy() {
        video?.stopPlayback()
        video = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Watched to the end, like the morning video.
    }

    companion object {
        private const val KEY_POSITION = "position"

        fun intent(context: Context): Intent =
            Intent(context, PromiseVideoActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
