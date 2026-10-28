package br.com.assfinadoni

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate

@Composable internal fun ReminderCenter() {
 val c=LocalContext.current;val api=remember{FinanceApi(c.applicationContext)};val scope=rememberCoroutineScope()
 var rows by remember{mutableStateOf<List<JSONObject>>(emptyList())};var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf<String?>(null)}
 var creating by remember{mutableStateOf(false)};var description by remember{mutableStateOf("")};var date by remember{mutableStateOf(LocalDate.now().plusDays(1).toString())};var hour by remember{mutableStateOf("9")};var cancel by remember{mutableStateOf<JSONObject?>(null)}
 val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){ }
 fun refresh(){scope.launch{busy=true;try{val a=api.call("GET","/api/reminders").getJSONArray("reminders");rows=(0 until a.length()).map{a.getJSONObject(it)};ReminderScheduler.sync(c);error=null}catch(e:Exception){error=e.message}finally{busy=false}}}
 LaunchedEffect(Unit){refresh()}
 Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
 Text("Lembretes e notificações",style=MaterialTheme.typography.titleLarge)
 Text("Avisos locais: 3 dias, 1 dia e no vencimento, no horário de Brasília. A sincronização é periódica, não é push imediato.")
 Button(onClick={if(Build.VERSION.SDK_INT>=33)permission.launch(Manifest.permission.POST_NOTIFICATIONS)else c.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,c.packageName))}){Text("Permitir notificações")}
 OutlinedButton(onClick={c.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,c.packageName))}){Text("Configurações de avisos")}
 if(Build.VERSION.SDK_INT>=31)OutlinedButton(onClick={c.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+c.packageName)))}){Text("Permitir horário exato")}
 OutlinedButton(onClick={ReminderScheduler.show(c,"test_"+System.currentTimeMillis())}){Text("Testar aviso nativo")}
 Text("Sem essa permissão o Android pode atrasar os avisos. Abra o app após reinstalar ou forçar a parada. Alterações feitas em outro aparelho precisam ser sincronizadas.",style=MaterialTheme.typography.bodySmall)
 Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={creating=true},enabled=!busy){Text("Novo lembrete")};OutlinedButton(onClick={refresh()},enabled=!busy){Text("Sincronizar")}}
 if(busy)LinearProgressIndicator(Modifier.fillMaxWidth());error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
 if(rows.isEmpty()&&!busy)Text("Nenhum lembrete pessoal pendente.")
 rows.forEach{r->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(r.optString("description"));Text("Vencimento: "+r.optString("due_date"));Text(if(r.optBoolean("notify_push"))"Aviso ativado" else "Aviso desativado");TextButton(onClick={cancel=r},enabled=!busy){Text("Cancelar lembrete")}}}}
 }
 if(creating)AlertDialog(onDismissRequest={if(!busy)creating=false},title={Text("Novo lembrete")},text={Column{OutlinedTextField(description,{description=it},label={Text("Descrição")});OutlinedTextField(date,{date=it},label={Text("Vencimento: AAAA-MM-DD")});OutlinedTextField(hour,{hour=it},label={Text("Hora: 0 a 23")});Text("Não cria despesa. Registre o pagamento no dashboard completo.");error?.let{Text(it)}}},confirmButton={TextButton(enabled=!busy,onClick={scope.launch{busy=true;try{LocalDate.parse(date);val h=hour.toInt();require(h in 0..23&&description.isNotBlank());api.call("POST","/api/reminders",JSONObject().put("kind","bill").put("description",description.trim()).put("due_date",date).put("reminder_hour",h).put("reminder_offsets",org.json.JSONArray("[3,1,0]")).put("notify_push",true).put("notify_telegram",false));creating=false;description="";refresh()}catch(e:Exception){error=e.message?:"Confira os campos"}finally{busy=false}}}){Text("Criar")}},dismissButton={TextButton(onClick={creating=false},enabled=!busy){Text("Voltar")}})
 cancel?.let{r->AlertDialog(onDismissRequest={cancel=null},title={Text("Cancelar lembrete?")},text={Text(r.optString("description"))},confirmButton={TextButton(enabled=!busy,onClick={scope.launch{busy=true;try{api.call("PATCH","/api/reminders",JSONObject().put("id",r.getString("id")).put("action","cancel"));cancel=null;refresh()}catch(e:Exception){error=e.message}finally{busy=false}}}){Text("Confirmar")}},dismissButton={TextButton(onClick={cancel=null}){Text("Voltar")}})}
}
