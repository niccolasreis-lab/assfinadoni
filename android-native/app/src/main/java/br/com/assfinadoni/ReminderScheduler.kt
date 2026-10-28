package br.com.assfinadoni

import android.Manifest
import android.app.*
import android.content.*
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.*
import java.util.concurrent.TimeUnit

internal object ReminderTimes {
    fun times(date: String, hour: Int, offsets: List<Int>): List<Long> {
        require(hour in 0..23 && offsets.size <= 3 && offsets.all { it in listOf(0,1,3) })
        return offsets.distinct().map { LocalDate.parse(date).minusDays(it.toLong()).atTime(hour, 0).atZone(ZoneId.of("America/Sao_Paulo")).toInstant().toEpochMilli() }
    }
}

internal object ReminderScheduler {
    private const val CHANNEL = "finance_reminders_v1"
    private fun prefs(c: Context) = c.getSharedPreferences("native_reminder_schedule", Context.MODE_PRIVATE)
    fun initialize(c: Context) {
        c.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"Lembretes financeiros",NotificationManager.IMPORTANCE_DEFAULT).apply { description="Avisos de vencimentos sem valores na tela bloqueada"; lockscreenVisibility=Notification.VISIBILITY_PRIVATE })
        val request=PeriodicWorkRequestBuilder<ReminderSyncWorker>(15,TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("finance-reminder-sync",ExistingPeriodicWorkPolicy.KEEP,request)
    }
    private fun intent(c: Context, key: String) = Intent(c,ReminderReceiver::class.java).setAction("br.com.assfinadoni.REMINDER").setData(android.net.Uri.parse("assfinadoni://reminder/"+key))
    private fun pending(c: Context,key:String)=PendingIntent.getBroadcast(c,0,intent(c,key),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Synchronized fun clear(c: Context) {
        val alarm=c.getSystemService(AlarmManager::class.java)
        val old=runCatching { JSONObject(prefs(c).getString("scheduled","{}")!!) }.getOrDefault(JSONObject())
        old.keys().forEach { alarm.cancel(pending(c,it)) }
        val generation=prefs(c).getLong("generation",0)+1
        prefs(c).edit().clear().putLong("generation",generation).apply()
        NotificationManagerCompat.from(c).cancelAll()
    }
    @Synchronized fun pause(c:Context) { clear(c);prefs(c).edit().putBoolean("paused",true).commit() }
    @Synchronized fun resume(c:Context) { prefs(c).edit().putBoolean("paused",false).commit() }
    @Synchronized private fun capture(c:Context):Long? = if(prefs(c).getBoolean("paused",false)) null else prefs(c).getLong("generation",0)
    suspend fun sync(c: Context) {
        val generation=capture(c) ?: return
        val api=FinanceApi(c)
        val account=api.session()
        if(account==null) { pause(c);return }
        val data=api.call("GET","/api/reminders").getJSONArray("reminders")
        reconcile(c,account.id,data,generation)
    }
    @Synchronized private fun reconcile(c:Context, owner:String, rows:JSONArray, generation:Long) {
        if(prefs(c).getBoolean("paused",false) || prefs(c).getLong("generation",0)!=generation) return
        if(prefs(c).getString("owner",null)!=owner) clear(c)
        val alarms=c.getSystemService(AlarmManager::class.java)
        val old=JSONObject(prefs(c).getString("scheduled","{}")!!)
        val next=JSONObject(); val now=System.currentTimeMillis()
        for(i in 0 until rows.length()) {
            val r=rows.getJSONObject(i)
            if(r.optString("status")!="pending" || !r.optBoolean("notify_push")) continue
            val offsets=r.optJSONArray("reminder_offsets")?:JSONArray("[0]")
            val times=runCatching { ReminderTimes.times(r.getString("due_date"),r.optInt("reminder_hour",9),(0 until offsets.length()).map { offsets.getInt(it) }) }.getOrDefault(emptyList())
            for(t in times) {
                val key=r.getString("id")+"_"+t
                if(t < now-86400000L || prefs(c).getBoolean("fired_$key",false)) continue
                next.put(key,t)
                if(t<=now) show(c,key) else {
                    val pi=pending(c,key)
                    if(Build.VERSION.SDK_INT<31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,t,pi)
                    else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,t,pi)
                }
            }
        }
        old.keys().forEach { if(!next.has(it)) alarms.cancel(pending(c,it)) }
        prefs(c).edit().putString("owner",owner).putString("scheduled",next.toString()).putLong("last_sync",now).apply()
    }
    fun show(c:Context,key:String) {
        if(Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(c,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return
        if(!NotificationManagerCompat.from(c).areNotificationsEnabled()) return
        val open=PendingIntent.getActivity(c,0,Intent(c,DashboardActivity::class.java).putExtra("open_reminders",true),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n=NotificationCompat.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle("Assistente de Finanças").setContentText("Você tem um lembrete para conferir. Abra seu financeiro.").setContentIntent(open).addAction(0,"Abrir lembretes",open).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        NotificationManagerCompat.from(c).notify(key.hashCode(),n)
        prefs(c).edit().putBoolean("fired_$key",true).apply()
    }
    fun restore(c:Context) {
        val rows=JSONObject(prefs(c).getString("scheduled","{}")!!); val now=System.currentTimeMillis();val alarm=c.getSystemService(AlarmManager::class.java)
        rows.keys().forEach { key -> val t=rows.optLong(key);if(t>now) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,t,pending(c,key)) }
        initialize(c)
    }
    fun scheduled(c:Context,key:String)=runCatching { JSONObject(prefs(c).getString("scheduled","{}")!!).has(key) }.getOrDefault(false)
    fun lastSync(c:Context)=prefs(c).getLong("last_sync",0)
}
class ReminderReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        val key=intent.data?.lastPathSegment?:return
        if(ReminderScheduler.scheduled(context,key)) ReminderScheduler.show(context,key)
    }
}
class ReminderBootReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) { ReminderScheduler.restore(context) }
}
class ReminderSyncWorker(c:Context,p:WorkerParameters):CoroutineWorker(c,p) {
    override suspend fun doWork():Result = try { ReminderScheduler.sync(applicationContext);Result.success() } catch(e:Exception) { Result.retry() }
}
