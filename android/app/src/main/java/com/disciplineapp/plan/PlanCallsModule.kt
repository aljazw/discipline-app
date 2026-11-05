package com.disciplineapp.plan

import com.disciplineapp.sleep.SleepSchedule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

/** JS bridge for plan calls: arm them after "@plan_calls" changes, and take the one that rang. */
class PlanCallsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    init {
        current = WeakReference(ctx)
    }

    override fun getName(): String = "PlanCalls"

    @ReactMethod
    fun schedule(promise: Promise) {
        PlanCalls.schedule(ctx)
        promise.resolve(true)
    }

    /** The call that rang and wasn't shown yet (its JSON), cleared as it's taken; or null. */
    @ReactMethod
    fun takeOpen(promise: Promise) {
        val prefs = SleepSchedule.prefs(ctx)
        val open = prefs.getString(PlanCalls.KEY_OPEN, null)
        if (open != null) prefs.edit().remove(PlanCalls.KEY_OPEN).apply()
        promise.resolve(open)
    }

    /** Clears the call's notification once it's been decided. */
    @ReactMethod
    fun dismiss() {
        PlanCalls.dismiss(ctx)
    }

    @ReactMethod
    fun addListener(eventName: String) { }

    @ReactMethod
    fun removeListeners(count: Int) { }

    companion object {
        const val EVENT = "PlanCall"
        private var current: WeakReference<ReactApplicationContext>? = null

        /** Tells a running app a call rang, so it shows it at once. */
        fun emitCall(json: String) {
            val ctx = current?.get() ?: return
            try {
                if (ctx.hasActiveReactInstance()) {
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT, json)
                }
            } catch (_: Exception) { }
        }
    }
}
