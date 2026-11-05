package com.disciplineapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService
import com.disciplineapp.alarm.WakeAlarm
import com.disciplineapp.plan.PlanCalls

/**
 * Restarts the protection layers after a reboot or an app update.
 *
 *  - DNS VPN: restarted only if it was on AND consent is still granted
 *    (VpnService.prepare returns null when already consented).
 *  - Wake-up alarm and plan calls: alarms don't survive a reboot, so they're armed again.
 *
 * Note: Android will NOT deliver these broadcasts after a manual "Force stop"
 * until the app is opened again — an OS guarantee no ordinary app can bypass
 * without Device Owner privileges.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                // Before the first unlock app storage can't be read (it would
                // crash); BOOT_COMPLETED follows once the user unlocks.
                if (!AccessibilityUtils.isUserUnlocked(context)) return
                if (dnsWasEnabled(context) && VpnService.prepare(context) == null) {
                    DnsVpnService.start(context)
                }
                WakeAlarm.schedule(context)
                PlanCalls.schedule(context)
            }
        }
    }

    private fun dnsWasEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences("BlockedPrefs", Context.MODE_PRIVATE)
        return prefs.getString("@dns_enabled", "false") == "true"
    }
}
