package br.com.assfinadoni
import org.junit.Test
import org.junit.Assert.*
class StartupGateTest {
 @Test fun readyOnce(){val g=StartupGate();val n=g.begin();assertTrue(g.ready(n));assertFalse(g.ready(n));assertEquals(StartupGate.Stage.READY,g.stage)}
 @Test fun failureCannotBecomeSuccess(){val g=StartupGate();val n=g.begin();assertTrue(g.fail(n));assertFalse(g.ready(n));assertEquals(StartupGate.Stage.ERROR,g.stage)}
 @Test fun retryIgnoresOldResponses(){val g=StartupGate();val old=g.begin();g.fail(old);val next=g.begin();assertFalse(g.ready(old));assertFalse(g.fail(old));assertTrue(g.ready(next))}
 @Test fun timeoutAfterSuccessDoesNotOwnReadiness(){val g=StartupGate();val old=g.begin();val now=g.begin();assertFalse(g.fail(old));assertTrue(g.ready(now))}
 @Test fun rendererFailureAfterReady(){val g=StartupGate();val n=g.begin();g.ready(n);assertTrue(g.fail(n));assertFalse(g.ready(n))}
}
