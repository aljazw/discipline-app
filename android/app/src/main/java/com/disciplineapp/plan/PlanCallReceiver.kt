package com.disciplineapp.plan

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Rings a plan call, then arms the next; re-arms when the clock or time zone changes. */
class PlanCallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            ACTION_FIRE -> {
                intent.getStringExtra(PlanCalls.EXTRA_CALL)?.let { PlanCalls.ring(context, it) }
                PlanCalls.schedule(context)
            }
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> PlanCalls.schedule(context)
        }
    }

    companion object {
        const val ACTION_FIRE = "com.disciplineapp.plan.CALL"
    }
}
