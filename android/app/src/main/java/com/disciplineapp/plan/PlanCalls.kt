package com.disciplineapp.plan

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.disciplineapp.MainActivity
import com.disciplineapp.R
import com.disciplineapp.sleep.SleepSchedule
import org.json.JSONArray
import org.json.JSONObject

/**
 * The plan's "calls": a habit that's due, or tasks that ran out of time. The
 * JS side works out when each one rings and writes them to the shared
 * "BlockedPrefs" as "@plan_calls", a JSON array of
 *   { "id": string, "at": epoch ms, "title": string, "body": string }.
 * Only the next one is armed; when it fires, the app opens over whatever is
 * on screen (like the wake-up alarm) and the one after it is armed.
 */
object PlanCalls {

    const val KEY_CALLS = "@plan_calls"
    /** The call that rang last and hasn't been shown in the app yet; read by JS. */
    const val KEY_OPEN = "@plan_call_open"
    const val EXTRA_CALL = "planCall"
    private const val REQUEST_FIRE = 7101
    private const val REQUEST_OPEN = 7102
    private const val CHANNEL = "plan_calls"
    const val NOTIF_ID = 7103

    data class Call(val id: String, val at: Long, val title: String, val body: String) {
        fun toJson(): String = JSONObject()
            .put("id", id).put("at", at).put("title", title).put("body", body)
            .toString()
    }

    fun load(context: Context): List<Call> = try {
        val array = JSONArray(SleepSchedule.prefs(context).getString(KEY_CALLS, null) ?: "[]")
        (0 until array.length()).mapNotNull { i ->
            val o = array.optJSONObject(i) ?: return@mapNotNull null
            val id = o.optString("id")
            val at = o.optLong("at", 0)
            if (id.isEmpty() || at <= 0) null
            else Call(id, at, o.optString("title"), o.optString("body"))
        }
    } catch (_: Exception) {
        emptyList()
    }

    /** Arms the next call after now (or nothing). Never throws. */
    fun schedule(context: Context) {
        try {
            val am = context.getSystemService(AlarmManager::class.java) ?: return
            am.cancel(firePendingIntent(context, null))
            val now = System.currentTimeMillis()
            val next = load(context).filter { it.at > now }.minByOrNull { it.at } ?: return
            val fire = firePendingIntent(context, next.id)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, fire)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, fire)
            }
        } catch (_: Exception) { }
    }

    /** Rings a call: remembers it for the app, shows it, and opens the app over the screen. */
    fun ring(context: Context, id: String) {
        val call = load(context).firstOrNull { it.id == id } ?: return
        SleepSchedule.prefs(context).edit().putString(KEY_OPEN, call.toJson()).apply()
        val open = openPendingIntent(context)
        try {
            ensureChannel(context)
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle(call.title)
                .setContentText(call.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(call.body))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                // Only deciding in the app clears it.
                .setOngoing(true)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .build()
            context.getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification)
        } catch (_: Exception) { }
        // With the screen on and unlocked the full-screen intent is only a heads-up;
        // the overlay permission lets the app come to the front anyway.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)) {
            try {
                context.startActivity(openIntent(context))
            } catch (_: Exception) { }
        }
        PlanCallsModule.emitCall(call.toJson())
    }

    fun dismiss(context: Context) {
        try {
            context.getSystemService(NotificationManager::class.java).cancel(NOTIF_ID)
        } catch (_: Exception) { }
    }

    private fun openIntent(context: Context): Intent =
        Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL, true)

    private fun openPendingIntent(context: Context): PendingIntent =
        PendingIntent.getActivity(
            context,
            REQUEST_OPEN,
            openIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** One alarm slot for all calls: the same request code and action, the id rides along. */
    private fun firePendingIntent(context: Context, id: String?): PendingIntent {
        val intent = Intent(context, PlanCallReceiver::class.java).setAction(PlanCallReceiver.ACTION_FIRE)
        if (id != null) intent.putExtra(EXTRA_CALL, id)
        return PendingIntent.getBroadcast(
            context,
            REQUEST_FIRE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Habit and task calls", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Opens the app when a habit is due or a task ran out of time."
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setShowBadge(false)
            },
        )
    }
}
