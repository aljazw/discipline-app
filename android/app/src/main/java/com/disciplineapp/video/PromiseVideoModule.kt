package com.disciplineapp.video

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** JS bridge: plays the "keep your word" video; playToEnd tells whether it was watched to the end. */
class PromiseVideoModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), ActivityEventListener {

    private var pending: Promise? = null

    init {
        ctx.addActivityEventListener(this)
    }

    override fun getName(): String = "PromiseVideo"

    @ReactMethod
    fun play() {
        val activity = ctx.currentActivity
        if (activity != null) {
            activity.startActivity(PromiseVideoActivity.intent(activity))
        } else {
            ctx.startActivity(PromiseVideoActivity.intent(ctx))
        }
    }

    /** Resolves true once the video played to the end, false if it was left some other way. */
    @ReactMethod
    fun playToEnd(promise: Promise) {
        val activity = ctx.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        pending?.resolve(false)
        pending = promise
        try {
            activity.startActivityForResult(
                Intent(activity, PromiseVideoActivity::class.java),
                REQUEST_CODE,
            )
        } catch (_: Exception) {
            pending = null
            promise.resolve(false)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return
        pending?.resolve(resultCode == Activity.RESULT_OK)
        pending = null
    }

    override fun onNewIntent(intent: Intent) { }

    companion object {
        private const val REQUEST_CODE = 7201
    }
}
