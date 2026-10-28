package br.com.assfinadoni
import org.junit.Test
import org.junit.Assert.*
class DashboardOriginTest {
 @Test fun productionOnly(){assertTrue(DashboardOrigin.trusted("https://assfinadoni.vercel.app/"));assertTrue(DashboardOrigin.trusted("https://assfinadoni.vercel.app:443/api/reminders"))}
 @Test fun hostileOrigins(){listOf("http://assfinadoni.vercel.app/","https://evil.example","https://assfinadoni.vercel.app.evil.example","https://evil.example@assfinadoni.vercel.app/","https://assfinadoni.vercel.app:444/","file:///sdcard/test.html","javascript:alert(1)","intent://bad","https://assfinandoni.vercel.app/","").forEach{assertFalse(it,DashboardOrigin.trusted(it))}}
 @Test fun nullInput(){assertFalse(DashboardOrigin.trusted(null))}
}
