package br.com.assfinadoni

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

internal object ReleasePolicy {
    const val MAX_BYTES = 50L * 1024 * 1024
    fun allowed(url:String):Boolean = runCatching {
        val u=URI(url)
        u.scheme=="https" && u.host=="jhpappaakmdfxyujnlef.supabase.co" && u.port in listOf(-1,443) && u.userInfo==null && u.rawQuery==null && u.fragment==null &&
            u.rawPath.startsWith("/storage/v1/object/public/android-releases/") && u.rawPath.endsWith(".apk") && !u.rawPath.contains("%") && !u.rawPath.contains("..")
    }.getOrDefault(false)
    fun valid(code:Int, installed:Int, url:String, hash:String, bytes:Long):Boolean = code>installed && allowed(url) && hash.matches(Regex("[a-fA-F0-9]{64}")) && bytes in 1..MAX_BYTES
}
internal data class AndroidRelease(val code:Int,val name:String,val url:String,val hash:String,val bytes:Long,val notes:String) {
    fun json()=JSONObject().put("available",true).put("version",name).put("notes",notes)
}
internal class AppUpdater(private val context:Context) {
    private val client=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(15,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).callTimeout(180,TimeUnit.SECONDS).build()
    suspend fun latest():AndroidRelease?=withContext(Dispatchers.IO) {
        client.newCall(Request.Builder().url(DashboardOrigin.BASE+"/api/app-version").build()).execute().use { response ->
            check(response.isSuccessful){"Não foi possível consultar a versão."}
            val body=response.body?:error("Resposta vazia.")
            val source=body.source();source.request(16385)
            check(source.buffer.size<=16384){"Resposta inválida."}
            val data=JSONObject(source.readUtf8())
            val release=AndroidRelease(data.optInt("version_code"),data.optString("version_name").take(60),data.optString("download_url"),data.optString("sha256"),data.optLong("size_bytes"),data.optString("release_notes").take(2000))
            if(ReleasePolicy.valid(release.code,BuildConfig.VERSION_CODE,release.url,release.hash,release.bytes))release else null
        }
    }
    suspend fun download(release:AndroidRelease):File=withContext(Dispatchers.IO) {
        check(ReleasePolicy.valid(release.code,BuildConfig.VERSION_CODE,release.url,release.hash,release.bytes))
        val directory=File(context.cacheDir,"updates").apply{mkdirs()}
        directory.listFiles()?.filter{it.name.startsWith("release-")}?.forEach{it.delete()}
        val file=File(directory,"release-${release.code}.apk")
        try {
            client.newCall(Request.Builder().url(release.url).build()).execute().use { response ->
                check(response.isSuccessful){"Falha no download."}
                val body=response.body?:error("Arquivo vazio.")
                check(body.contentLength()==-1L || body.contentLength()==release.bytes){"Tamanho inválido."}
                var count=0L;val digest=MessageDigest.getInstance("SHA-256")
                body.byteStream().use { input -> file.outputStream().use { output ->
                    val buffer=ByteArray(16384)
                    while(true){ val n=input.read(buffer);if(n<0)break;count+=n;check(count<=release.bytes){"Arquivo maior que o esperado."};digest.update(buffer,0,n);output.write(buffer,0,n) }
                } }
                check(count==release.bytes && digest.digest().joinToString(""){"%02x".format(it)}.equals(release.hash,true)){"O arquivo não passou na verificação de integridade."}
            }
            verify(file,release.code);file
        } catch(e:Exception){file.delete();throw e}
    }
    @Suppress("DEPRECATION")
    fun verify(file:File, expected:Int) {
        val pm=context.packageManager
        val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive=pm.getPackageArchiveInfo(file.absolutePath,flags)?:error("APK inválido.")
        val installed=pm.getPackageInfo(context.packageName,flags)
        fun code(info:PackageInfo)=if(Build.VERSION.SDK_INT>=28)info.longVersionCode else info.versionCode.toLong()
        fun signatures(info:PackageInfo)=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else info.signatures
        fun fingerprints(info:PackageInfo)=signatures(info)?.map{signature -> MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString(""){"%02x".format(it)}}?.toSet().orEmpty()
        val trusted=fingerprints(installed)
        check(archive.packageName==context.packageName && code(archive)==expected.toLong() && code(archive)>code(installed) && trusted.isNotEmpty() && fingerprints(archive)==trusted){"Pacote, versão ou assinatura não correspondem a este aplicativo."}
    }
}
