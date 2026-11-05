package com.disciplineapp

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.net.Uri
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.disciplineapp.sleep.SleepActivity
import com.disciplineapp.sleep.SleepSchedule
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

class BlockAccessibilityService : AccessibilityService() {

    // Gson ignores Kotlin null-safety, so every stored field is nullable here and
    // entries missing required fields are skipped instead of crashing later.
    data class BlockedWebsite(
        val days: String? = null,
        val time: String? = null,
        val websiteUrl: String? = null,
        val visible: Boolean? = null,
        /** Minutes a day it may be used during its schedule; null = blocked outright. */
        val limit: Int? = null
    )

    data class BlockedApp(
        val days: String? = null,
        val time: String? = null,
        val packageName: String? = null,
        val appName: String? = null,
        val visible: Boolean? = null,
        val limit: Int? = null
    )

    /** A blocked site or app with its schedule parsed once, when the list is loaded. */
    private class ParsedBlock(
        /** Website URL, or the app's display name for app blocks. */
        val url: String,
        val days: Set<String>,
        val start: LocalTime?,
        val end: LocalTime?,
        /** Daily allowance while the schedule is on; null = always blocked then. */
        val limitMs: Long? = null,
        /** Where its time is counted in [UsageLimits]. */
        val usageKey: String = ""
    ) {
        fun isActive(day: String, now: LocalTime): Boolean {
            if (day !in days) return false
            // No usable time range (empty, "All Day Long", malformed) = all day.
            if (start == null || end == null) return true
            // Start is inclusive, end exclusive; ranges may wrap past midnight.
            return if (start <= end) {
                !now.isBefore(start) && now.isBefore(end)
            } else {
                !now.isBefore(start) || now.isBefore(end)
            }
        }
    }

    // Default to an empty list to avoid UninitializedPropertyAccessException crashes
    private var blockedList: List<ParsedBlock> = emptyList()
    /** Blocked apps keyed by package name, for an O(1) lookup on every event. */
    private var blockedApps: Map<String, ParsedBlock> = emptyMap()
    private lateinit var sharedPref: SharedPreferences

    private var lastProcessedTime: Long = 0
    private var lastGuardTime: Long = 0
    private var lastAppBlockTime: Long = 0
    private var lastSleepTime: Long = 0
    private var sleepSchedule: SleepSchedule? = null
    private var vacation: Vacation? = null

    /** Packages that stay usable during sleep time; rebuilt now and then since defaults can change. */
    private var sleepAllowed: Set<String> = emptySet()
    private var sleepAllowedBuiltAt: Long = 0

    /** Keyboards: they come and go over apps without the app being left. */
    private var keyboards: Set<String> = emptySet()
    private var keyboardsBuiltAt: Long = 0

    private var usage: UsageLimits? = null
    private val handler = Handler(Looper.getMainLooper())
    private val limitTick = Runnable { checkLimitedUse() }

    /** Screen off: whatever was being timed isn't being used any more. */
    private val screenOffReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            stopTiming()
        }
    }

    companion object {
        private const val TAG = "BlockedService"
        private const val PREFS_NAME = "BlockedPrefs"
        private const val KEY_BLOCKED = "@blocked_websites"
        private const val KEY_BLOCKED_APPS = "@blocked_apps"
        private const val FULL_WEEK = "Full Week"
        private const val ALL_DAY = "All Day Long"
        private const val DEBOUNCE_INTERVAL = 500L
        private const val GUARD_DEBOUNCE = 1500L
        private const val APP_BLOCK_DEBOUNCE = 800L
        private const val SLEEP_DEBOUNCE = 800L
        private const val SLEEP_ALLOWED_TTL = 60_000L
        private const val MAX_DETAIL_CLICKABLE = 3
        private const val MAX_TREE_DEPTH = 40
        /** How often time on a limited app or site is re-checked and saved. */
        private const val LIMIT_TICK = 15_000L
        private const val MAX_LIMIT_MINUTES = 24 * 60

        private val gson = Gson()
        private val listType = object : TypeToken<List<BlockedWebsite?>>() {}.type
        private val appListType = object : TypeToken<List<BlockedApp?>>() {}.type
        private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        private val timePattern = Regex("""^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$""")
        private val ALL_DAYS = setOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")
        /** Always usable during sleep: system UI, calls and emergency, alarms, messages, camera. */
        private val SLEEP_ALWAYS_ALLOWED = setOf(
            "android",
            "com.android.systemui",
            "com.android.phone",
            "com.android.server.telecom",
            "com.android.incallui",
            "com.android.emergency",
            "com.google.android.dialer",
            "com.google.android.deskclock",
            "com.android.deskclock",
            "com.sec.android.app.clockpackage",
            "com.samsung.android.incallui",
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.android.mms",
            "com.google.android.GoogleCamera",
            "com.sec.android.app.camera",
            "com.android.camera",
            "com.android.camera2",
        )
        private val BROWSER_PACKAGES = setOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.google.android.apps.chrome",
            "org.mozilla.firefox",
            "org.mozilla.firefox_beta",
            "org.mozilla.focus",
            "com.brave.browser",
            "com.opera.browser",
            "com.opera.mini.native",
            "com.opera.gx",
            "com.sec.android.app.sbrowser", // Samsung Internet, the default on Samsung phones
            "com.microsoft.emmx", // Edge
            "com.duckduckgo.mobile.android",
            "com.vivaldi.browser",
            "com.kiwibrowser.browser",
            "com.mi.globalbrowser",
            "com.UCMobile.intl",
        )
    }

    private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        when (key) {
            KEY_BLOCKED -> loadBlockedList()
            KEY_BLOCKED_APPS -> loadBlockedApps()
            SleepSchedule.KEY_SCHEDULE -> sleepSchedule = SleepSchedule.load(sharedPref)
            Vacation.KEY -> vacation = Vacation.load(sharedPref)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        sharedPref = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        sharedPref.registerOnSharedPreferenceChangeListener(prefsListener)
        loadBlockedList()
        loadBlockedApps()
        sleepSchedule = SleepSchedule.load(sharedPref)
        vacation = Vacation.load(sharedPref)
        usage = UsageLimits(sharedPref)
        try {
            registerReceiver(screenOffReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF))
        } catch (e: Exception) {
            Log.w(TAG, "Could not watch screen off", e)
        }

        // If a "turned off" alert was showing, the service is back: clear it.
        ProtectionAlerts.onProtectionRestored(applicationContext)
    }

    override fun onUnbind(intent: Intent?): Boolean {
        // Android also unbinds us on shutdown, on app updates and whenever it
        // restarts our process, so this is NOT proof the user switched us off.
        // The check reads the real setting a few seconds later and alerts only
        // on a true disable.
        ProtectionAlerts.scheduleCheck(applicationContext)
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(limitTick)
        usage?.track(null)
        try {
            unregisterReceiver(screenOffReceiver)
        } catch (_: Exception) { }
        if (::sharedPref.isInitialized) {
            sharedPref.unregisterOnSharedPreferenceChangeListener(prefsListener)
        }
        // This runs both when the user disables the service AND on ordinary
        // teardown (app update / config change). The check reads the canonical
        // setting, so it only alerts on a real disable.
        ProtectionAlerts.scheduleCheck(applicationContext)
    }

    private fun loadBlockedList() {
        // A removed/empty preference means "nothing blocked", not "keep the old list".
        val jsonData = sharedPref.getString(KEY_BLOCKED, null)
        if (jsonData == null) {
            blockedList = emptyList()
            return
        }

        blockedList = try {
            gson.fromJson<List<BlockedWebsite?>>(jsonData, listType)
                ?.mapNotNull { item ->
                    if (item == null || item.websiteUrl.isNullOrBlank()) null
                    else parseSchedule(item.days, item.time, item.websiteUrl, item.limit, UsageLimits.siteKey(item.websiteUrl))
                }
                ?: emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse blocked list", e)
            emptyList()
        }
    }

    private fun loadBlockedApps() {
        val jsonData = sharedPref.getString(KEY_BLOCKED_APPS, null)
        blockedApps = if (jsonData == null) {
            emptyMap()
        } else try {
            gson.fromJson<List<BlockedApp?>>(jsonData, appListType)
                ?.mapNotNull { item ->
                    if (item == null || item.packageName.isNullOrBlank()) null
                    else item.packageName to parseSchedule(
                        item.days,
                        item.time,
                        item.appName ?: item.packageName,
                        item.limit,
                        UsageLimits.appKey(item.packageName),
                    )
                }
                ?.toMap()
                ?: emptyMap()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse blocked apps", e)
            emptyMap()
        }
    }

    /**
     * Parses one entry's schedule. Never throws: a bad time (e.g. "25:99") falls
     * back to all day, so one damaged entry can't disable every other block.
     */
    private fun parseSchedule(
        daysText: String?,
        time: String?,
        label: String,
        limit: Int? = null,
        usageKey: String = "",
    ): ParsedBlock {
        val days = when {
            daysText == null || daysText == FULL_WEEK -> ALL_DAYS
            else -> daysText.split(",").map { it.trim().trim('\'').lowercase() }.toSet()
        }

        var start: LocalTime? = null
        var end: LocalTime? = null
        if (time != null && !time.equals(ALL_DAY, ignoreCase = true) && timePattern.matches(time)) {
            try {
                val (startStr, endStr) = time.split("-").map { it.trim() }
                start = LocalTime.parse(startStr, timeFormatter)
                end = LocalTime.parse(endStr, timeFormatter)
            } catch (e: Exception) {
                Log.w(TAG, "Bad time range '$time' for $label, blocking all day", e)
                start = null
                end = null
            }
        }
        // A limit outside 1 min..24 h is damaged data: block outright rather than allow.
        val limitMs = limit?.takeIf { it in 1 until MAX_LIMIT_MINUTES }?.let { it * 60_000L }
        return ParsedBlock(label, days, start, end, limitMs, usageKey)
    }

    private fun today(): String = LocalDate.now().dayOfWeek.name.take(3).lowercase()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        // An uncaught exception here crashes the service, and Android then turns
        // it off — silently disabling all protection. Never let that happen.
        try {
            handleEvent(event)
        } catch (e: Exception) {
            Log.e(TAG, "Error while handling accessibility event", e)
        }
    }

    private fun handleEvent(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return

        // On vacation nothing is blocked; only the settings guard keeps running,
        // so the blocks are still in place when the vacation ends.
        if (vacation?.isActive() == true) {
            stopTiming()
            if (isSettingsPackage(packageName)) handleSettingsGuard()
            return
        }

        // Sleep time covers everything except the essentials and Settings (the settings guard still runs there).
        if (shouldCoverForSleep(packageName, event)) {
            stopTiming()
            if (System.currentTimeMillis() - lastSleepTime > SLEEP_DEBOUNCE) {
                lastSleepTime = System.currentTimeMillis()
                startSleepActivity()
            }
            return
        }

        if (isSettingsPackage(packageName)) {
            stopTiming()
            handleSettingsGuard()
            return
        }

        // A blocked app is on screen: cover it with the block page,
        // or time it when it has a daily limit that isn't used up yet.
        if (packageName != applicationContext.packageName) {
            val app = blockedApps[packageName]
            if (app != null && app.isActive(today(), LocalTime.now())) {
                if (withinLimit(app)) {
                    startTiming(app.usageKey)
                } else {
                    blockApp(packageName, app)
                }
                return
            }
        }

        // Switched to something else (a keyboard or the status bar don't count).
        // A browser only ends a limited app's time; its own sites are checked below.
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && !isPassThrough(packageName) &&
            (!isBrowser(packageName) || usage?.activeKey?.startsWith("app:") == true)
        ) {
            stopTiming()
        }

        // Debounce browser evaluation
        if (System.currentTimeMillis() - lastProcessedTime < DEBOUNCE_INTERVAL) return
        if (!isBrowser(packageName)) return

        val rootNode = rootInActiveWindow ?: return
        try {
            val match = findBlockedMatch(rootNode)
            when {
                match == null -> if (usage?.activeKey?.startsWith("site:") == true) stopTiming()
                withinLimit(match) -> startTiming(match.usageKey)
                else -> {
                    lastProcessedTime = System.currentTimeMillis()
                    stopTiming()
                    startBlockedActivity(match, packageName)
                }
            }
        } finally {
            rootNode.recycleCompat()
        }
    }

    // ---- Daily limits -------------------------------------------------------

    /** Has a limit and some of it left today. */
    private fun withinLimit(block: ParsedBlock): Boolean {
        val limit = block.limitMs ?: return false
        return (usage?.usedMs(block.usageKey) ?: 0L) < limit
    }

    private fun startTiming(key: String) {
        val tracker = usage ?: return
        if (tracker.activeKey == key) return
        tracker.track(key)
        scheduleLimitCheck()
    }

    private fun stopTiming() {
        val tracker = usage ?: return
        handler.removeCallbacks(limitTick)
        if (tracker.activeKey != null) tracker.track(null)
    }

    /** Re-checks when the time left runs out, or sooner to save progress. */
    private fun scheduleLimitCheck() {
        handler.removeCallbacks(limitTick)
        val tracker = usage ?: return
        val key = tracker.activeKey ?: return
        val block = blockForKey(key) ?: return
        val left = (block.limitMs ?: 0L) - tracker.usedMs(key)
        handler.postDelayed(limitTick, left.coerceIn(500L, LIMIT_TICK))
    }

    private fun blockForKey(key: String): ParsedBlock? =
        if (key.startsWith("app:")) blockedApps[key.removePrefix("app:")]
        else blockedList.firstOrNull { it.usageKey == key }

    /**
     * Runs while something limited is being timed: banks the time, makes sure
     * it's still on screen, and puts up the block page once the limit is used up.
     */
    private fun checkLimitedUse() {
        try {
            val tracker = usage ?: return
            val key = tracker.activeKey ?: return
            tracker.flush()
            val power = getSystemService(Context.POWER_SERVICE) as? PowerManager
            val block = blockForKey(key)
            if (power?.isInteractive == false || block == null || vacation?.isActive() == true ||
                !block.isActive(today(), LocalTime.now())
            ) {
                stopTiming()
                return
            }

            val root = rootInActiveWindow
            val onScreen = root?.packageName?.toString()
            try {
                val stillThere = when {
                    onScreen == null || isPassThrough(onScreen) -> true
                    key.startsWith("app:") -> onScreen == key.removePrefix("app:")
                    root != null && isBrowser(onScreen) -> findBlockedMatch(root)?.usageKey == key
                    else -> false
                }
                if (!stillThere) {
                    stopTiming()
                    return
                }
                if (withinLimit(block)) {
                    scheduleLimitCheck()
                    return
                }
                stopTiming()
                if (key.startsWith("app:")) {
                    blockApp(key.removePrefix("app:"), block)
                } else if (onScreen != null) {
                    lastProcessedTime = System.currentTimeMillis()
                    startBlockedActivity(block, onScreen)
                }
            } finally {
                root?.recycleCompat()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error while checking a daily limit", e)
        }
    }

    private fun blockApp(packageName: String, app: ParsedBlock) {
        if (System.currentTimeMillis() - lastAppBlockTime > APP_BLOCK_DEBOUNCE) {
            lastAppBlockTime = System.currentTimeMillis()
            stopTiming()
            startBlockedAppActivity(packageName, app)
        }
    }

    /** Windows that sit on top of an app without leaving it: the status bar, keyboards. */
    private fun isPassThrough(packageName: String): Boolean =
        packageName == "com.android.systemui" || packageName in keyboardPackages()

    private fun keyboardPackages(): Set<String> {
        val now = System.currentTimeMillis()
        if (now - keyboardsBuiltAt < SLEEP_ALLOWED_TTL) return keyboards
        keyboardsBuiltAt = now
        keyboards = try {
            Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_INPUT_METHODS)
                ?.split(':')
                ?.mapNotNull { it.substringBefore('/').takeIf(String::isNotBlank) }
                ?.toSet()
                ?: emptySet()
        } catch (_: Exception) {
            emptySet()
        }
        return keyboards
    }

    // ---- Sleep time ---------------------------------------------------------

    private fun shouldCoverForSleep(packageName: String, event: AccessibilityEvent): Boolean {
        val schedule = sleepSchedule ?: return false
        if (!SleepSchedule.isSleepTimeNow(sharedPref, schedule)) return false
        // Settings stays usable (Wi-Fi, Bluetooth, alarms); the settings guard still protects the app there.
        if (isSettingsPackage(packageName)) return false
        if (packageName == applicationContext.packageName) {
            // Our own app is covered too (otherwise sleep time could just be switched
            // off there), but not our native pages: the sleep page, guard, block page.
            return event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
                event.className?.toString() == MainActivity::class.java.name
        }
        return packageName !in sleepAllowedPackages()
    }

    private fun sleepAllowedPackages(): Set<String> {
        val now = System.currentTimeMillis()
        if (now - sleepAllowedBuiltAt < SLEEP_ALLOWED_TTL) return sleepAllowed
        sleepAllowedBuiltAt = now

        val allowed = SLEEP_ALWAYS_ALLOWED.toMutableSet()
        val pm = applicationContext.packageManager
        fun add(intent: Intent) {
            try {
                pm.resolveActivity(intent, 0)?.activityInfo?.packageName?.let { allowed += it }
            } catch (_: Exception) { }
        }
        add(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)) // launcher
        add(Intent(AlarmClock.ACTION_SHOW_ALARMS)) // clock
        add(Intent(Intent.ACTION_DIAL)) // dialer
        add(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:"))) // messages
        add(Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)) // camera
        add(Intent(MediaStore.ACTION_IMAGE_CAPTURE)) // camera, when only capture is exposed
        try {
            Telephony.Sms.getDefaultSmsPackage(applicationContext)?.let { allowed += it }
        } catch (_: Exception) { }
        try {
            (getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)?.defaultDialerPackage?.let { allowed += it }
        } catch (_: Exception) { }
        // Keyboards, so the sleep page's passphrase can be typed.
        allowed += keyboardPackages()

        sleepAllowed = allowed
        return allowed
    }

    private fun startSleepActivity() {
        val intent = Intent(applicationContext, SleepActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        applicationContext.startActivity(intent)
    }

    // ---- Anti-disable guard ------------------------------------------------
    // This only runs while our service is ENABLED (the service isn't alive
    // otherwise), so it prevents reaching the OFF toggle without ever
    // blocking the user from turning the service ON.
    //
    // Universal detection: the Settings app is in front AND the screen shows
    // our app's name (app_name). The app name is a brand string — identical
    // on every OEM and in every language — so this works everywhere, unlike
    // matching localized phrases or OEM-specific view IDs.
    //
    // Fire only on our OWN on/off page, not the full accessibility
    // list. Signals (all structural, OEM/language-neutral):
    //   • the app name is shown, AND
    //   • there's a toggle, AND
    //   • there are FEW clickable rows. The list is many tappable rows
    //     (one per app + categories) so it's excluded by its length; a
    //     detail page has just a handful of controls.
    private fun handleSettingsGuard() {
        if (System.currentTimeMillis() - lastGuardTime <= GUARD_DEBOUNCE) return
        val root = rootInActiveWindow ?: return
        try {
            val matches = root.findAccessibilityNodeInfosByText(appName).orEmpty()
            val appNameShown = matches.isNotEmpty()
            matches.forEach { it.recycleCompat() }

            if (appNameShown &&
                countToggles(root, 0) >= 1 &&
                countClickable(root, 0) <= MAX_DETAIL_CLICKABLE
            ) {
                lastGuardTime = System.currentTimeMillis()
                ProtectionAlerts.fireGuard(applicationContext)
            }
        } finally {
            root.recycleCompat()
        }
    }

    /**
     * The scheduled-active blocked site whose URL is shown in an unfocused URL
     * bar. One that must be blocked now wins over one with time left today.
     */
    private fun findBlockedMatch(root: AccessibilityNodeInfo): ParsedBlock? {
        val currentDay = today()
        val now = LocalTime.now()
        var allowed: ParsedBlock? = null

        for (item in blockedList) {
            if (!item.isActive(currentDay, now)) continue

            val matchingNodes = root.findAccessibilityNodeInfosByText(item.url).orEmpty()
            val valid = matchingNodes.any { node ->
                node.className == "android.widget.EditText" && !node.isFocused
            }
            matchingNodes.forEach { it.recycleCompat() }
            if (!valid) continue
            if (!withinLimit(item)) return item
            if (allowed == null) allowed = item
        }
        return allowed
    }

    override fun onInterrupt() {
        // Handle service interruption if needed
    }

    /** Number of clickable elements on screen (rows, buttons, switches). */
    private fun countClickable(node: AccessibilityNodeInfo, depth: Int): Int {
        if (depth > MAX_TREE_DEPTH) return 0
        var count = if (node.isClickable) 1 else 0
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            count += countClickable(child, depth + 1)
            child.recycleCompat()
        }
        return count
    }

    private fun countToggles(node: AccessibilityNodeInfo, depth: Int): Int {
        if (depth > MAX_TREE_DEPTH) return 0
        var count = 0
        val cn = node.className?.toString() ?: ""
        if (node.isCheckable || cn.contains("Switch", true) || cn.contains("Toggle", true)) {
            count++
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            count += countToggles(child, depth + 1)
            child.recycleCompat()
        }
        return count
    }

    private fun isSettingsPackage(packageName: String): Boolean {
        // Stock is com.android.settings; some OEMs vary, so also accept any
        // package whose name contains "settings". Never our own package.
        if (packageName == applicationContext.packageName) return false
        return packageName == "com.android.settings" ||
            packageName.contains("settings", ignoreCase = true)
    }

    private fun isBrowser(packageName: String?): Boolean =
        packageName != null && packageName in BROWSER_PACKAGES

    /** Nodes only need recycling before API 33; it is a no-op afterwards. */
    @Suppress("DEPRECATION")
    private fun AccessibilityNodeInfo.recycleCompat() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) recycle()
    }

    private fun startBlockedAppActivity(packageName: String, app: ParsedBlock) {
        val intent = Intent()
        intent.setClassName(applicationContext.packageName, BlockedPageActivity::class.java.name)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        intent.putExtra("blocked_app_name", app.url)
        intent.putExtra("package_name", packageName)
        app.limitMs?.let { intent.putExtra(BlockedPageActivity.EXTRA_LIMIT_MINUTES, (it / 60_000L).toInt()) }
        applicationContext.startActivity(intent)
    }

    private fun startBlockedActivity(site: ParsedBlock, packageName: String) {
        val intent = Intent()
        intent.setClassName(applicationContext.packageName, BlockedPageActivity::class.java.name)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.putExtra("blocked_url", site.url)
        intent.putExtra("package_name", packageName)
        site.limitMs?.let { intent.putExtra(BlockedPageActivity.EXTRA_LIMIT_MINUTES, (it / 60_000L).toInt()) }
        applicationContext.startActivity(intent)
    }
}
