package com.disciplineapp.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SurveyMachineTest {

    /** A fake phone clock: wall clock and monotonic clock advance together unless told otherwise. */
    private var utc = 1_762_500_000_000L
    private var mono = 50_000L
    private fun now() = Moment(utc, mono)
    private fun advance(ms: Long) { utc += ms; mono += ms }

    private fun fix(lat: Double = 45.0, lon: Double = 14.0, accuracy: Double? = 4.0, ageMs: Long = 0) =
        Fix(lat = lat, lon = lon, mono = mono - ageMs, gpsTime = utc - ageMs + 120, accuracy = accuracy, speed = 1.5, altitude = 2.0)

    private fun survey() = SurveyRecord(id = "s1", name = "Test", bootCount = 7)

    private fun record(rec: SurveyRecord, action: SurveyAction, text: String? = null) = rec.apply(action, now(), text)

    @Test
    fun allowsOnlyTheSpecifiedTransitions() {
        val s = SurveyMachine
        assertEquals(SurveyState.CAMERA_RECORDING_STARTED, s.next(SurveyState.IDLE, SurveyAction.START_CAMERA))
        assertEquals(SurveyState.MOVING, s.next(SurveyState.CAMERA_RECORDING_STARTED, SurveyAction.START_MOVING))
        assertEquals(SurveyState.PAUSED, s.next(SurveyState.MOVING, SurveyAction.PAUSE))
        assertEquals(SurveyState.MOVING, s.next(SurveyState.PAUSED, SurveyAction.RESUME))
        assertEquals(SurveyState.COMPLETED, s.next(SurveyState.MOVING, SurveyAction.STOP))
        assertEquals(SurveyState.COMPLETED, s.next(SurveyState.PAUSED, SurveyAction.STOP))
        assertEquals(SurveyState.DISCARDED, s.next(SurveyState.CAMERA_RECORDING_STARTED, SurveyAction.DISCARD))

        assertNull(s.next(SurveyState.IDLE, SurveyAction.START_MOVING))
        assertNull(s.next(SurveyState.CAMERA_RECORDING_STARTED, SurveyAction.PAUSE))
        assertNull(s.next(SurveyState.MOVING, SurveyAction.RESUME))
        assertNull(s.next(SurveyState.CAMERA_RECORDING_STARTED, SurveyAction.STOP))
        assertNull(s.next(SurveyState.IDLE, SurveyAction.STOP))
        assertNull(s.next(SurveyState.MOVING, SurveyAction.START_CAMERA))
        assertNull(s.next(SurveyState.MOVING, SurveyAction.DISCARD))
        assertNull(s.next(SurveyState.COMPLETED, SurveyAction.RESUME))
        assertNull(s.next(SurveyState.IDLE, SurveyAction.ADD_MARKER))
        assertEquals(listOf(SurveyAction.START_CAMERA), s.allowed(SurveyState.IDLE))
    }

    @Test
    fun refusesInvalidPressesWithoutChangingAnything() {
        val rec = survey()
        try {
            record(rec, SurveyAction.START_MOVING)
            fail("moving before the camera started must be refused")
        } catch (e: IllegalStateException) {
            assertEquals("Press Recording started first.", e.message)
        }
        assertEquals(SurveyState.IDLE, rec.state)
        assertTrue(rec.events.isEmpty())
    }

    @Test
    fun cameraStartIsStoredSeparatelyAndCollectsNoPoints() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        val camera = now()
        // Warm-up fixes while waiting to move are not track points.
        advance(1000)
        assertNull(rec.onFix(fix(), now()).point)
        advance(9000)
        record(rec, SurveyAction.START_MOVING)
        assertEquals(camera, rec.cameraStart)
        assertEquals(now(), rec.movementStart)
        assertEquals(10_000L, rec.movementStart!!.mono - rec.cameraStart!!.mono)
        assertEquals(0, rec.pointCount)
        assertEquals(
            listOf(SurveyEventType.CAMERA_RECORDING_STARTED, SurveyEventType.MOVEMENT_STARTED),
            rec.events.map { it.type },
        )
        // The movement start got the warm-up fix (9 s old) as its position.
        val start = rec.events[1]
        assertEquals(45.0, start.lat!!, 0.0)
        assertEquals(4.0, start.accuracy!!, 0.0)
        assertEquals(9000L, start.fixAgeMs)
    }

    @Test
    fun collectsEveryFixWhileMovingAndNoneWhilePaused() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        repeat(10) { i ->
            advance(1000)
            val p = rec.onFix(fix(lat = 45.0 + i * 0.00001), now()).point
            assertNotNull(p)
            assertEquals(0, p!!.segment)
            assertEquals(mono, p.mono)
            assertEquals(utc, p.utc)
        }
        assertEquals(10, rec.pointCount)

        record(rec, SurveyAction.PAUSE)
        repeat(5) {
            advance(1000)
            assertNull(rec.onFix(fix(), now()).point)
        }
        assertEquals(10, rec.pointCount)

        record(rec, SurveyAction.RESUME)
        advance(1000)
        assertEquals(1, rec.onFix(fix(), now()).point!!.segment)
        assertEquals(11, rec.pointCount)
    }

    @Test
    fun ignoresRepeatedAndStaleFixes() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        advance(1000)
        val f = fix()
        assertNotNull(rec.onFix(f, now()).point)
        assertNull(rec.onFix(f, now()).point)
        // A fix taken before Resume (delivered late) isn't part of the new stretch.
        record(rec, SurveyAction.PAUSE)
        advance(3000)
        val old = fix(ageMs = 500)
        advance(10)
        record(rec, SurveyAction.RESUME)
        assertNull(rec.onFix(old, now()).point)
    }

    @Test
    fun durationsUseTheMonotonicClockOnly() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        advance(5_000)
        record(rec, SurveyAction.START_MOVING)
        advance(60_000)
        record(rec, SurveyAction.PAUSE)
        advance(20_000)
        // Someone sets the phone clock back an hour while paused: durations must not care.
        utc -= 3_600_000
        record(rec, SurveyAction.RESUME)
        advance(30_000)
        record(rec, SurveyAction.STOP)
        val end = rec.stop!!.mono

        assertEquals(115_000L, rec.totalElapsedMs(end))
        assertEquals(110_000L, rec.surveyElapsedMs(end))
        assertEquals(90_000L, rec.activeMovementMs(end))
        assertEquals(20_000L, rec.pausedMs(end))
        assertEquals(SurveyState.COMPLETED, rec.state)
    }

    @Test
    fun pausesAreExplicitInTheEventHistory() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        advance(10_000)
        record(rec, SurveyAction.PAUSE)
        val pausedAt = now()
        advance(7_000)
        record(rec, SurveyAction.RESUME)
        val resumedAt = now()
        advance(10_000)
        record(rec, SurveyAction.PAUSE)
        advance(4_000)
        record(rec, SurveyAction.STOP)

        assertEquals(
            listOf("CAMERA_RECORDING_STARTED", "MOVEMENT_STARTED", "PAUSED", "RESUMED", "PAUSED", "SURVEY_STOPPED"),
            rec.events.map { it.type },
        )
        val pauses = rec.pauses()
        assertEquals(2, pauses.size)
        assertEquals(pausedAt, pauses[0].start)
        assertEquals(resumedAt, pauses[0].end)
        assertEquals(7_000L, pauses[0].durationMs(0))
        // A pause still open at Stop ends at Stop.
        assertEquals(rec.stop, pauses[1].end)
        assertEquals(4_000L, pauses[1].durationMs(0))
        assertEquals(20_000L, rec.activeMovementMs(rec.stop!!.mono))
        // Event times are in order on the monotonic clock.
        assertEquals(rec.events.map { it.mono }.sorted(), rec.events.map { it.mono })
    }

    @Test
    fun markersCarryPositionTimeAndOptionalText() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        advance(1000)
        rec.onFix(fix(lat = 45.1, lon = 14.2, accuracy = 3.0), now())
        advance(400)
        val m1 = record(rec, SurveyAction.ADD_MARKER, "  Rock ")
        val m2 = record(rec, SurveyAction.ADD_MARKER, "")
        assertEquals("Rock", m1.text)
        assertNull(m2.text)
        assertEquals(1, m1.number)
        assertEquals(2, m2.number)
        assertEquals(45.1, m1.lat!!, 0.0)
        assertEquals(14.2, m1.lon!!, 0.0)
        assertEquals(3.0, m1.accuracy!!, 0.0)
        assertEquals(400L, m1.fixAgeMs)
        assertEquals(utc, m1.utc)
        assertEquals(mono, m1.mono)
        assertTrue(rec.labelMarker(2, "Seabed change"))
        assertEquals("Seabed change", rec.events.last().text)
        assertFalse(rec.labelMarker(9, "x"))
        assertEquals(SurveyState.MOVING, rec.state)
    }

    @Test
    fun eventWithoutAFreshFixGetsTheNextOne() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        val ev = rec.events.single()
        assertTrue(ev.positionPending)
        assertNull(ev.lat)
        advance(3000)
        assertTrue(rec.onFix(fix(lat = 44.9), now()).eventsChanged)
        assertFalse(ev.positionPending)
        assertEquals(44.9, ev.lat!!, 0.0)
        assertEquals(-3000L, ev.fixAgeMs)
    }

    @Test
    fun signalLossIsRecordedAndPointsResumeAfterIt() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        advance(1000)
        rec.onFix(fix(), now())
        // Four quiet seconds: still fine.
        repeat(4) { advance(1000); assertFalse(rec.tick(now())) }
        advance(1000)
        assertTrue(rec.tick(now()))
        assertTrue(rec.gpsLost)
        assertFalse(rec.tick(now()))
        assertEquals(SurveyEventType.GPS_LOST, rec.events.last().type)
        // Weak fixes after the gap are still stored, not thrown away.
        advance(20_000)
        val result = rec.onFix(fix(accuracy = 80.0), now())
        assertTrue(result.eventsChanged)
        assertNotNull(result.point)
        assertEquals(80.0, result.point!!.accuracy!!, 0.0)
        assertFalse(rec.gpsLost)
        assertEquals(SurveyEventType.GPS_RESTORED, rec.events.last().type)
        assertEquals(2, rec.pointCount)
        // The moving time isn't interrupted by a lost signal.
        assertEquals(26_000L, rec.activeMovementMs(mono))
    }

    @Test
    fun waitingForTheFirstFixIsNotALostSignal() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        // A GPS cold start: two minutes without any fix.
        repeat(120) { advance(1000); assertFalse(rec.tick(now())) }
        assertFalse(rec.gpsLost)
        assertTrue(rec.events.none { it.type == SurveyEventType.GPS_LOST })
        // The movement start gets the first fix that arrives (within 30 s it would; this is later).
        advance(1000)
        assertNotNull(rec.onFix(fix(), now()).point)
        assertEquals(1, rec.pointCount)
    }

    @Test
    fun pointsKeepWhichProviderMadeThem() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        advance(1000)
        val rough = rec.onFix(fix(accuracy = 60.0).copy(provider = "fused"), now()).point!!
        advance(1000)
        val gps = rec.onFix(fix().copy(provider = "gps"), now()).point!!
        assertEquals("fused", rough.provider)
        assertEquals("gps", gps.provider)
    }

    @Test
    fun inaccurateFixesDontAddDistance() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        advance(1000); rec.onFix(fix(lat = 45.0), now())
        advance(1000); rec.onFix(fix(lat = 45.01, accuracy = 200.0), now())
        advance(1000); rec.onFix(fix(lat = 45.0001), now())
        assertEquals(3, rec.pointCount)
        assertEquals(11.1, rec.distance, 0.2)
    }

    @Test
    fun phoneRestartKeepsTheTimelineContinuous() {
        val rec = survey()
        record(rec, SurveyAction.START_CAMERA)
        record(rec, SurveyAction.START_MOVING)
        advance(60_000)
        val lastSeen = now()
        // Phone off for 2 minutes; after boot the monotonic clock starts again near zero.
        utc += 120_000
        mono = 8_000
        rec.onRestart(rawNow = mono, utcNow = utc, lastSeen = lastSeen, newBootCount = 8)
        val restarted = rec.events.last()
        assertEquals(SurveyEventType.DEVICE_RESTARTED, restarted.type)
        assertEquals(lastSeen.mono + 120_000, restarted.mono)
        assertEquals(8, rec.bootCount)
        assertEquals(1, rec.segment)
        // Only the 60 s with GPS count as moving.
        assertEquals(60_000L, rec.activeMovementMs(restarted.mono))
        assertEquals(180_000L, rec.surveyElapsedMs(restarted.mono))
    }
}
