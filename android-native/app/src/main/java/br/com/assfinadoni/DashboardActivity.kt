package br.com.assfinadoni

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.provider.MediaStore
import android.provider.Settings
import android.view.View
import android.webkit.*
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File

internal object DashboardOrigin {
    const val BASE = "https://assfinadoni.vercel.app"
    fun trusted(value:String?):Boolean = runCatching {
        val u=java.net.URI(value ?: "")
        u.scheme=="https" && u.host=="assfinadoni.vercel.app" && u.rawUserInfo==null && (u.port==-1 || u.port==443)
    }.getOrDefault(false)
}

class DashboardActivity:ComponentActivity() {
    private lateinit var web:WebView
    private lateinit var progress:ProgressBar
    private lateinit var failure:LinearLayout
    private lateinit var cover:ImageView
    private var chooser:ValueCallback<Array<Uri>>?=null
    private var cameraUri:Uri?=null
    private var mediaPermission:PermissionRequest?=null
    private var loaded=false
    private val sessionMutex=Mutex()
    private var syncing=false
    private val notifications=registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        Toast.makeText(this,if(allowed)"Notificações permitidas. Use Testar aviso." else "Notificações não permitidas. Você pode alterar nas configurações.",Toast.LENGTH_LONG).show()
    }
    private val microphone=registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        val request=mediaPermission;mediaPermission=null
        if(allowed && trustedPage() && request?.origin?.toString()?.let(DashboardOrigin::trusted)==true) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request?.deny()
    }
    private val files=registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val value=if(result.resultCode==RESULT_OK) WebChromeClient.FileChooserParams.parseResult(result.resultCode,result.data) ?: cameraUri?.let { arrayOf(it) } else null
        chooser?.onReceiveValue(value);chooser=null;cameraUri=null
    }
    private fun trustedPage():Boolean = DashboardOrigin.trusted(web.url) && Uri.parse(web.url).path in listOf("/","/index.html","")
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        ReminderScheduler.initialize(applicationContext)
        val frame=FrameLayout(this).apply{setBackgroundColor(0xfff7f8f7.toInt())};web=WebView(this);progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal)
        androidx.core.view.WindowInsetsControllerCompat(window,window.decorView).apply { isAppearanceLightStatusBars=true;isAppearanceLightNavigationBars=true }
        frame.addView(web,FrameLayout.LayoutParams(-1,-1))
        cover=ImageView(this).apply{setImageResource(R.drawable.cover_image);scaleType=ImageView.ScaleType.FIT_CENTER;setBackgroundColor(0xff032719.toInt())}
        frame.addView(cover,FrameLayout.LayoutParams(-1,-1));frame.addView(progress,FrameLayout.LayoutParams(-1,6))
        failure=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;gravity=android.view.Gravity.CENTER;setPadding(32,32,32,32);setBackgroundColor(0xfff7f8f7.toInt());visibility=View.GONE }
        failure.addView(TextView(this).apply { text="Não foi possível abrir seu financeiro. Confira a conexão e tente novamente.";textSize=18f })
        failure.addView(Button(this).apply {text="Tentar novamente";setOnClickListener{openDashboard()}})
        frame.addView(failure,FrameLayout.LayoutParams(-1,-1));setContentView(frame)
        ViewCompat.setOnApplyWindowInsetsListener(frame) { view,insets -> val b=insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime());view.setPadding(b.left,b.top,b.right,b.bottom);insets }
        web.settings.apply {
            javaScriptEnabled=true;domStorageEnabled=true;cacheMode=WebSettings.LOAD_NO_CACHE
            allowFileAccess=false;allowContentAccess=true;mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setGeolocationEnabled(false);setSupportMultipleWindows(true);javaScriptCanOpenWindowsAutomatically=false
            mediaPlaybackRequiresUserGesture=true;safeBrowsingEnabled=true
        }
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val script=assets.open("dashboard-native.js").bufferedReader().use{it.readText()}
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) Toast.makeText(this,"Atualize o Android System WebView para usar a integração de notificações.",Toast.LENGTH_LONG).show()
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web,"FinanceAndroid",setOf(DashboardOrigin.BASE)) { _,message,origin,main,reply ->
                if(!main || !DashboardOrigin.trusted(origin.toString()) || !trustedPage()) return@addWebMessageListener
                val text=message.data?:return@addWebMessageListener
                if(text.length>12000)return@addWebMessageListener
                val payload=runCatching{JSONObject(text)}.getOrNull()?:return@addWebMessageListener
                val id=payload.optString("id").take(30)
                fun answer(message:String)=reply.postMessage(JSONObject().put("id",id).put("message",message).toString())
                when(payload.optString("action")) {
                    "sync" -> lifecycleScope.launch { try {syncSession();answer("Lembretes sincronizados. Avisos locais; sincronização periódica, sem push imediato.")}catch(e:Exception){reply.postMessage(JSONObject().put("id",id).put("error","Não foi possível sincronizar. Confira sua conexão e login.").toString())} }
                    "enable" -> {if(Build.VERSION.SDK_INT>=33)notifications.launch(Manifest.permission.POST_NOTIFICATIONS) else notificationSettings();answer("Confira a permissão do Android e use Testar aviso.")}
                    "settings" -> {notificationSettings();answer("Configurações abertas no Android.")}
                    "exact" -> {if(Build.VERSION.SDK_INT>=31)startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:$packageName")));answer("Sem permissão de horário exato, o Android pode atrasar os avisos.")}
                    "test" -> {if(NotificationManagerCompat.from(this).areNotificationsEnabled()){ReminderScheduler.show(this,"test_"+System.currentTimeMillis());answer("Aviso de teste solicitado ao Android.")}else answer("Permita notificações nas configurações do Android primeiro.")}
                    "share" -> {startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply{type="text/plain";putExtra(Intent.EXTRA_SUBJECT,payload.optString("title").take(180));putExtra(Intent.EXTRA_TEXT,payload.optString("text").take(8000))},"Compartilhar lançamento"));answer("Compartilhamento aberto.")}
                }
            }
            if(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) WebViewCompat.addDocumentStartJavaScript(web,script,setOf(DashboardOrigin.BASE))
        }
        web.webViewClient=object:WebViewClient(){
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
                if(!request.isForMainFrame)return !DashboardOrigin.trusted(request.url.toString())
                if(DashboardOrigin.trusted(request.url.toString()))return false
                external(request.url);return true
            }
            override fun onPageStarted(view:WebView,url:String?,favicon:android.graphics.Bitmap?){loaded=false;progress.visibility=View.VISIBLE;failure.visibility=View.GONE}
            override fun onPageFinished(view:WebView,url:String?){progress.visibility=View.GONE;cover.visibility=View.GONE;if(trustedPage()){loaded=true;view.evaluateJavascript(script,null);syncQuietly();if(intent.getBooleanExtra("open_reminders",false)){intent.removeExtra("open_reminders");view.evaluateJavascript("window.dispatchEvent(new Event('finance-native-open-reminders'))",null)}}}
            override fun onReceivedHttpError(view:WebView,request:WebResourceRequest,response:WebResourceResponse){if(request.isForMainFrame && response.statusCode>=400){failure.visibility=View.VISIBLE;progress.visibility=View.GONE}}
            override fun onReceivedError(view:WebView,request:WebResourceRequest,error:WebResourceError){if(request.isForMainFrame){loaded=false;failure.visibility=View.VISIBLE;progress.visibility=View.GONE}}
            override fun onReceivedSslError(view:WebView,handler:SslErrorHandler,error:SslError){handler.cancel();failure.visibility=View.VISIBLE}
        }
        web.webChromeClient=object:WebChromeClient(){
            override fun onProgressChanged(view:WebView,value:Int){progress.progress=value}
            override fun onPermissionRequest(request:PermissionRequest){
                if(!trustedPage() || !DashboardOrigin.trusted(request.origin.toString()) || !request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)){request.deny();return}
                if(ContextCompat.checkSelfPermission(this@DashboardActivity,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                else {mediaPermission?.deny();mediaPermission=request;microphone.launch(Manifest.permission.RECORD_AUDIO)}
            }
            override fun onPermissionRequestCanceled(request:PermissionRequest){if(mediaPermission===request)mediaPermission=null}
            override fun onShowFileChooser(view:WebView,callback:ValueCallback<Array<Uri>>,params:FileChooserParams):Boolean {
                if(!trustedPage())return false
                chooser?.onReceiveValue(null);chooser=callback
                val pick=params.createIntent().apply{addCategory(Intent.CATEGORY_OPENABLE)}
                val choose=Intent.createChooser(pick,"Selecionar anexo")
                if(params.acceptTypes.any{it.startsWith("image/")}){
                    val directory=File(cacheDir,"camera").apply{mkdirs()};val photo=File.createTempFile("comprovante_",".jpg",directory)
                    cameraUri=FileProvider.getUriForFile(this@DashboardActivity,"$packageName.fileprovider",photo)
                    val camera=Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,cameraUri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    if(camera.resolveActivity(packageManager)!=null)choose.putExtra(Intent.EXTRA_INITIAL_INTENTS,arrayOf(camera))
                }
                return try{files.launch(choose);true}catch(e:Exception){chooser?.onReceiveValue(null);chooser=null;false}
            }
            override fun onCreateWindow(view:WebView,isDialog:Boolean,isUserGesture:Boolean,resultMsg:Message):Boolean {
                if(!isUserGesture || !trustedPage())return false
                val child=WebView(this@DashboardActivity)
                child.webViewClient=object:WebViewClient(){override fun shouldOverrideUrlLoading(v:WebView,r:WebResourceRequest):Boolean{external(r.url);v.destroy();return true}}
                (resultMsg.obj as WebView.WebViewTransport).webView=child;resultMsg.sendToTarget();return true
            }
        }
        web.setDownloadListener{url,_,_,_,_->if(DashboardOrigin.trusted(url))download(url)else external(Uri.parse(url))}
        onBackPressedDispatcher.addCallback(this,object:OnBackPressedCallback(true){override fun handleOnBackPressed(){
            web.evaluateJavascript(assets.open("dashboard-back.js").bufferedReader().use{it.readText()}) { closed -> if(closed!="true"){if(web.canGoBack())web.goBack()else finish()} }
        }})
        // Migrate the existing encrypted app session only when the web session is absent.
        val manager=CookieManager.getInstance();val base=DashboardOrigin.BASE.toHttpUrl()
        val old=if(manager.getCookie(DashboardOrigin.BASE).isNullOrEmpty()) SecureCookieJar(this).loadForRequest(base) else emptyList()
        if(old.isEmpty()){manager.flush();openDashboard()} else {
            var remaining=old.size
            old.forEach { cookie -> manager.setCookie(DashboardOrigin.BASE,cookie.toString()) {
                remaining--;if(remaining==0 && !isFinishing && !isDestroyed){manager.flush();openDashboard()}
            } }
        }
    }
    override fun onNewIntent(intent:Intent) {
        super.onNewIntent(intent);setIntent(intent)
        if(intent.getBooleanExtra("open_reminders",false) && ::web.isInitialized) {
            if(loaded && trustedPage()) web.evaluateJavascript("document.getElementById('dashboard-view')?.hidden === false") { authenticated ->
                if(authenticated=="true")web.evaluateJavascript("window.dispatchEvent(new Event('finance-native-open-reminders'))",null) else openDashboard()
            } else openDashboard()
        }
    }
    private fun openDashboard(){failure.visibility=View.GONE;web.loadUrl(DashboardOrigin.BASE+if(intent.getBooleanExtra("open_reminders",false))"/?reminders=1" else "/")}
    private fun notificationSettings(){startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,packageName))}
    private fun external(uri:Uri){if(uri.scheme !in listOf("https","mailto","tel"))return;runCatching{startActivity(Intent(Intent.ACTION_VIEW,uri))}.onFailure{Toast.makeText(this,"Nenhum aplicativo disponível para este link.",Toast.LENGTH_SHORT).show()}}
    private suspend fun syncSession()=sessionMutex.withLock {
        if(!trustedPage())return@withLock
        val header=CookieManager.getInstance().getCookie(DashboardOrigin.BASE).orEmpty()
        val jar=SecureCookieJar(applicationContext);val base=DashboardOrigin.BASE.toHttpUrl()
        val incoming=header.split(';').filter { it.trim().startsWith("finance_session=") }.mapNotNull{Cookie.parse(base,it.trim()+"; Path=/; Secure; HttpOnly")}
        withContext(Dispatchers.IO){jar.replace(base,incoming)}
        CookieManager.getInstance().flush()
        if(incoming.isEmpty()) { ReminderScheduler.clear(applicationContext); return@withLock }
        ReminderScheduler.sync(applicationContext)
    }
    private fun syncQuietly(){if(syncing)return;syncing=true;lifecycleScope.launch{try{syncSession()}catch(_:Exception){}finally{syncing=false}}}
    override fun onResume(){super.onResume();if(::web.isInitialized && loaded){web.evaluateJavascript("window.dispatchEvent(new Event('finance-native-resume'))",null);syncQuietly()}}
    private fun download(url:String){lifecycleScope.launch{
        try{
            val uri=withContext(Dispatchers.IO){
                val client=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()
                val request=Request.Builder().url(url).header("Cookie",CookieManager.getInstance().getCookie(DashboardOrigin.BASE).orEmpty()).build()
                client.newCall(request).execute().use{r->
                    require(r.isSuccessful);val body=r.body?:error("Sem arquivo");require(body.contentLength()<=10_000_000)
                    val type=r.header("Content-Type").orEmpty().substringBefore(';');require(type in listOf("application/pdf","image/png","image/jpeg","text/csv"))
                    val suffix=when(type){"application/pdf"->".pdf";"image/png"->".png";"image/jpeg"->".jpg";else->".csv"}
                    val directory=File(cacheDir,"updates").apply{mkdirs()};val file=File.createTempFile("financeiro_",suffix,directory)
                    body.byteStream().use{input->file.outputStream().use{out->val buffer=ByteArray(8192);var count=0;while(true){val n=input.read(buffer);if(n<0)break;count+=n;require(count<=10_000_000);out.write(buffer,0,n)}}}
                    FileProvider.getUriForFile(this@DashboardActivity,"$packageName.fileprovider",file) to type
                }
            }
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri.first,uri.second).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }catch(_:Exception){Toast.makeText(this@DashboardActivity,"Não foi possível abrir o arquivo neste aparelho.",Toast.LENGTH_LONG).show()}
    }}
    override fun onDestroy(){chooser?.onReceiveValue(null);mediaPermission?.deny();web.stopLoading();web.destroy();super.onDestroy()}
}
