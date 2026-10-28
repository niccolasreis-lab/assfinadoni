package br.com.assfinadoni
import org.junit.Test
import org.junit.Assert.*
import java.time.Instant
class ReminderTimesTest {
 @Test fun brasiliaTime(){assertEquals(Instant.parse("2026-10-28T12:00:00Z").toEpochMilli(),ReminderTimes.times("2026-10-28",9,listOf(0)).single())}
 @Test fun monthBoundary(){val a=ReminderTimes.times("2027-01-01",9,listOf(3,1,0));assertEquals(Instant.parse("2026-12-29T12:00:00Z").toEpochMilli(),a.first());assertEquals(3,a.size)}
 @Test fun deduplicates(){assertEquals(1,ReminderTimes.times("2026-10-28",9,listOf(0,0)).size)}
 @Test(expected=IllegalArgumentException::class) fun invalidHour(){ReminderTimes.times("2026-10-28",24,listOf(0))}
 @Test(expected=IllegalArgumentException::class) fun invalidOffset(){ReminderTimes.times("2026-10-28",9,listOf(2))}
 @Test(expected=java.time.format.DateTimeParseException::class) fun invalidDate(){ReminderTimes.times("2026-02-30",9,listOf(0))}
}
