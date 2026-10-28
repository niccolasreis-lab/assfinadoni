package br.com.assfinadoni
import org.junit.Assert.*
import org.junit.Test
class ReleasePolicyTest {
    private val url="https://jhpappaakmdfxyujnlef.supabase.co/storage/v1/object/public/android-releases/finance-7.apk"
    @Test fun newerPinnedReleaseAllowed(){assertTrue(ReleasePolicy.valid(7,6,url,"a".repeat(64),1024))}
    @Test fun downgradeAndSameVersionRejected(){assertFalse(ReleasePolicy.valid(6,6,url,"a".repeat(64),1024));assertFalse(ReleasePolicy.valid(5,6,url,"a".repeat(64),1024))}
    @Test fun invalidIntegrityMetadataRejected(){assertFalse(ReleasePolicy.valid(7,6,url,"",1024));assertFalse(ReleasePolicy.valid(7,6,url,"a".repeat(64),0));assertFalse(ReleasePolicy.valid(7,6,url,"a".repeat(64),ReleasePolicy.MAX_BYTES+1))}
    @Test fun remoteAndAmbiguousUrlsRejected(){
        for(value in listOf(url.replace("https:","http:"),url.replace("jhpappaakmdfxyujnlef.supabase.co","evil.example"),url+"?redirect=1",url.replace("finance-7.apk","../finance-7.apk"),url.replace("finance-7.apk","%2e%2e/finance-7.apk"),url.replace("https://","https://user@")))assertFalse(value,ReleasePolicy.allowed(value))
    }
}
