package br.com.assfinadoni

import android.content.Context
import android.os.Bundle
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.SyncDisabled
import androidx.compose.material.icons.outlined.TrendingDown
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import br.com.assfinadoni.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.math.BigDecimal
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.concurrent.TimeUnit
import android.util.Base64
import java.io.ByteArrayOutputStream

private val Graphite = Color(0xFF080B12)
private val Surface = Color(0xFF121722)
private val SurfaceRaised = Color(0xFF171D29)
private val Violet = Color(0xFF7C3AED)
private val VioletContainer = Color(0xFF302347)
private val Text = Color(0xFFF8FAFC)
private val Muted = Color(0xFFA8B3C5)
private val Income = Color(0xFF4ADE80)
private val Expense = Color(0xFFFB7185)

data class Account(val id: String, val username: String, val name: String, val telegramLinked: Boolean)
data class FinanceTransaction(
    val id: String,
    val type: String,
    val amount: BigDecimal,
    val category: String,
    val description: String,
    val date: String,
    val shared: Boolean,
    val owner: Boolean
)
data class Summary(
    val income: BigDecimal = BigDecimal.ZERO,
    val expense: BigDecimal = BigDecimal.ZERO,
    val balance: BigDecimal = BigDecimal.ZERO,
    val byCategory: Map<String, BigDecimal> = emptyMap()
)
data class FinanceState(
    val loading: Boolean = true,
    val authenticated: Boolean = false,
    val account: Account? = null,
    val month: String = LocalDate.now().toString().take(7),
    val transactions: List<FinanceTransaction> = emptyList(),
    val summary: Summary = Summary(),
    val selected: FinanceTransaction? = null,
    val editing: FinanceTransaction? = null,
    val creating: Boolean = false,
    val pendingDelete: FinanceTransaction? = null,
    val message: String? = null,
    val error: String? = null
    ,val categories: List<String> = listOf("Alimentação", "Transporte", "Moradia", "Saúde", "Educação", "Lazer", "Assinaturas", "Outros")
)

private class SecureCookieJar(context: Context) : CookieJar {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "finance_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val editor = prefs.edit()
        cookies.forEach { cookie ->
            if (cookie.expiresAt <= System.currentTimeMillis()) editor.remove(cookie.name)
            else editor.putString(cookie.name, cookie.toString())
        }
        editor.apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> =
        prefs.all.values.mapNotNull { Cookie.parse(url, it as? String ?: return@mapNotNull null) }
            .filter { it.expiresAt > System.currentTimeMillis() && it.matches(url) }
}

private class FinanceApi(context: Context) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .cookieJar(SecureCookieJar(context))
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .build()
    private val base = BuildConfig.API_BASE_URL.trimEnd('/')

    private suspend fun call(method: String, path: String, payload: JSONObject? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(base + path).header("Accept", "application/json")
            if (method != "GET") builder.header("Origin", base)
            val body = payload?.toString()?.toRequestBody(jsonType)
            when (method) {
                "GET" -> builder.get()
                "POST" -> builder.post(body ?: "{}".toRequestBody(jsonType))
                "PATCH" -> builder.patch(body ?: "{}".toRequestBody(jsonType))
                "DELETE" -> builder.delete(body)
            }
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                val json = if (text.isBlank()) JSONObject() else JSONObject(text)
                if (!response.isSuccessful) throw IllegalStateException(json.optString("error", "Não foi possível concluir a operação."))
                json
            }
        }

    suspend fun session(): Account? {
        val json = call("GET", "/api/session")
        if (!json.optBoolean("authenticated")) return null
        return parseAccount(json.getJSONObject("account"))
    }

    suspend fun login(username: String, password: String): Account {
        val json = call("POST", "/api/session", JSONObject().put("username", username).put("password", password))
        return parseAccount(json.getJSONObject("account"))
    }

    suspend fun logout() { call("DELETE", "/api/session", JSONObject()) }

    suspend fun transactions(month: String): Pair<List<FinanceTransaction>, Summary> {
        val json = call("GET", "/api/transactions?month=" + month + "&page=1&scope=all&include_shared_summary=false")
        val rows = json.getJSONArray("transactions")
        val list = buildList {
            for (index in 0 until rows.length()) add(parseTransaction(rows.getJSONObject(index)))
        }
        return list to parseSummary(json.getJSONObject("summary"))
    }

    suspend fun categories(): List<String> = call("GET", "/api/categories").optJSONArray("categories")?.let { array -> buildList { for (i in 0 until array.length()) add(array.getJSONObject(i).optString("name")) } } ?: emptyList()
    suspend fun createCategory(name: String): String = call("POST", "/api/categories", JSONObject().put("name", name)).getJSONObject("category").optString("name")

    suspend fun save(row: FinanceTransaction?, draft: TransactionDraft): String {
        val body = JSONObject()
            .put("transaction_type", draft.type)
            .put("amount", draft.amount)
            .put("category", draft.category)
            .put("description", draft.description)
            .put("transaction_date", draft.date)
        val result = if (row == null) call("POST", "/api/transactions", body)
        else call("PATCH", "/api/transactions", body.put("id", row.id))
        return result.optJSONObject("transaction")?.optString("id").orEmpty().ifBlank { row?.id.orEmpty() }
    }

    suspend fun uploadImage(transactionId: String, uri: Uri, context: Context) {
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IllegalStateException("Não consegui ler a imagem.")
        if (bytes.size > 900_000) throw IllegalArgumentException("A imagem deve ter até 900 KB.")
        val type = context.contentResolver.getType(uri) ?: "image/jpeg"
        if (type !in listOf("image/jpeg", "image/png", "image/webp")) throw IllegalArgumentException("Use uma imagem JPG, PNG ou WebP.")
        val name = uri.lastPathSegment ?: "comprovante.jpg"
        call("POST", "/api/transaction-attachments", JSONObject().put("transaction_id", transactionId).put("filename", name).put("content_type", type).put("data_url", "data:$type;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)))
    }

    suspend fun delete(row: FinanceTransaction) {
        call("DELETE", "/api/transactions", JSONObject().put("id", row.id))
    }

    suspend fun share(row: FinanceTransaction) {
        if (row.shared) call("DELETE", "/api/shares", JSONObject().put("transaction_id", row.id))
        else call("POST", "/api/shares", JSONObject().put("transaction_id", row.id))
    }

    private fun parseAccount(json: JSONObject) = Account(
        json.optString("id"), json.optString("username"),
        json.optString("name", json.optString("username")),
        json.optBoolean("telegram_linked")
    )

    private fun parseTransaction(json: JSONObject) = FinanceTransaction(
        id = json.optString("id"),
        type = json.optString("transaction_type", "despesa"),
        amount = json.optString("amount", "0").toBigDecimalOrNull() ?: BigDecimal.ZERO,
        category = json.optString("category", "Outros"),
        description = json.optString("description", "Lançamento"),
        date = json.optString("transaction_date", LocalDate.now().toString()),
        shared = json.optBoolean("is_shared") || json.optBoolean("shared") || json.has("share_id"),
        owner = !json.has("is_owner") || json.optBoolean("is_owner")
    )

    private fun parseSummary(json: JSONObject): Summary {
        val categories = linkedMapOf<String, BigDecimal>()
        val raw = json.optJSONObject("byCategory") ?: json.optJSONObject("by_category") ?: JSONObject()
        raw.keys().forEach { key -> categories[key] = raw.optString(key, "0").toBigDecimalOrNull() ?: BigDecimal.ZERO }
        return Summary(
            json.optString("income", "0").toBigDecimalOrNull() ?: BigDecimal.ZERO,
            json.optString("expense", "0").toBigDecimalOrNull() ?: BigDecimal.ZERO,
            json.optString("balance", "0").toBigDecimalOrNull() ?: BigDecimal.ZERO,
            categories
        )
    }
}

data class TransactionDraft(
    val type: String,
    val amount: String,
    val category: String,
    val description: String,
    val date: String
)

private class FinanceViewModel(private val api: FinanceApi) : ViewModel() {
    private val mutableState = MutableStateFlow(FinanceState())
    val state = mutableState.asStateFlow()

    init { restoreSession() }

    private fun runTask(success: String? = null, block: suspend () -> Unit) {
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(loading = true, error = null, message = null)
            try {
                block()
                if (success != null) mutableState.value = mutableState.value.copy(message = success)
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Ocorreu um erro.")
            } finally {
                mutableState.value = mutableState.value.copy(loading = false)
            }
        }
    }

    private fun restoreSession() = runTask {
        val account = api.session()
        if (account == null) mutableState.value = FinanceState(loading = false)
        else {
            mutableState.value = mutableState.value.copy(authenticated = true, account = account)
            refreshInternal()
        }
    }

    fun login(username: String, password: String) = runTask {
        val account = api.login(username.trim().lowercase(), password)
        mutableState.value = mutableState.value.copy(authenticated = true, account = account)
        refreshInternal()
    }

    fun logout() = runTask {
        api.logout()
        mutableState.value = FinanceState(loading = false)
    }

    fun refresh() = runTask { refreshInternal() }

    private suspend fun refreshInternal() {
        val (transactions, summary) = api.transactions(mutableState.value.month)
        val cats = api.categories().ifEmpty { mutableState.value.categories }
        mutableState.value = mutableState.value.copy(transactions = transactions, summary = summary, categories = cats)
    }

    fun select(row: FinanceTransaction?) { mutableState.value = mutableState.value.copy(selected = row) }
    fun edit(row: FinanceTransaction?) { mutableState.value = mutableState.value.copy(selected = null, editing = row, creating = row == null) }
    fun closeEditor() { mutableState.value = mutableState.value.copy(editing = null, creating = false) }
    fun requestDelete(row: FinanceTransaction) { mutableState.value = mutableState.value.copy(selected = null, pendingDelete = row) }
    fun cancelDelete() { mutableState.value = mutableState.value.copy(pendingDelete = null) }
    fun clearFeedback() { mutableState.value = mutableState.value.copy(message = null, error = null) }

    fun save(draft: TransactionDraft, image: Uri? = null, context: Context? = null) = runTask(if (mutableState.value.creating) "Lançamento adicionado." else "Lançamento atualizado.") {
        if (draft.amount.toBigDecimalOrNull()?.signum() != 1) throw IllegalArgumentException("Informe um valor maior que zero.")
        if (draft.description.isBlank()) throw IllegalArgumentException("Descreva o lançamento.")
        LocalDate.parse(draft.date)
        val id = api.save(mutableState.value.editing, draft)
        if (image != null && context != null) api.uploadImage(id, image, context)
        mutableState.value = mutableState.value.copy(editing = null, creating = false)
        refreshInternal()
    }

    fun addCategory(name: String) = runTask { api.createCategory(name.trim()); refreshInternal() }

    fun deleteConfirmed() = runTask("Lançamento movido para a lixeira.") {
        val row = mutableState.value.pendingDelete ?: return@runTask
        api.delete(row)
        mutableState.value = mutableState.value.copy(pendingDelete = null)
        refreshInternal()
    }

    fun toggleShare(row: FinanceTransaction) = runTask(if (row.shared) "Compartilhamento removido." else "Lançamento compartilhado.") {
        api.share(row)
        mutableState.value = mutableState.value.copy(selected = null)
        refreshInternal()
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val api = FinanceApi(applicationContext)
        setContent {
            val vm: FinanceViewModel = androidx.lifecycle.viewmodel.compose.viewModel(
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T = FinanceViewModel(api) as T
                }
            )
            FinanceTheme { FinanceRoot(vm) }
        }
    }
}

@Composable
private fun FinanceTheme(content: @Composable () -> Unit) {
    val colors = darkColorScheme(
        primary = Violet,
        onPrimary = Color.White,
        primaryContainer = VioletContainer,
        onPrimaryContainer = Text,
        secondary = Color(0xFFF4B000),
        background = Graphite,
        onBackground = Text,
        surface = Surface,
        onSurface = Text,
        surfaceVariant = SurfaceRaised,
        onSurfaceVariant = Muted,
        error = Expense,
        outline = Color(0xFF3A4558)
    )
    MaterialTheme(colorScheme = colors, typography = Typography(), content = content)
}

@Composable
private fun FinanceRoot(vm: FinanceViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.message, state.error) {
        val text = state.error ?: state.message
        if (text != null) {
            snackbar.showSnackbar(text)
            vm.clearFeedback()
        }
    }

    if (!state.authenticated) LoginScreen(state.loading, state.error, vm::login)
    else FinanceShell(state, snackbar, vm)

    if (state.selected != null) TransactionActions(state.selected!!, vm)
    if (state.editing != null || state.creating) TransactionEditor(state.editing, state.categories, vm)
    if (state.pendingDelete != null) DeleteConfirmation(state.pendingDelete!!, vm)
}

@Composable
private fun LoginScreen(loading: Boolean, error: String?, onLogin: (String, String) -> Unit) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    Surface(Modifier.fillMaxSize(), color = Graphite) {
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(24.dp), contentAlignment = Alignment.Center) {
            Card(colors = CardDefaults.cardColors(containerColor = Surface), shape = RoundedCornerShape(20.dp), modifier = Modifier.widthIn(max = 440.dp)) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Text("Assistente de Finanças", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    Text("Nicolas & Ionara", color = MaterialTheme.colorScheme.secondary)
                    OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text("Usuário") }, singleLine = true)
                    OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Senha") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = { onLogin(username, password) }, enabled = !loading && username.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Entrar")
                    }
                }
            }
        }
    }
}

private enum class Destination(val label: String) { Overview("Visão geral"), Transactions("Transações"), More("Mais") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FinanceShell(state: FinanceState, snackbar: SnackbarHostState, vm: FinanceViewModel) {
    var destination by rememberSaveable { mutableStateOf(Destination.Overview) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 840.dp
        if (expanded) {
            Row(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                NavigationRail(containerColor = Graphite) {
                    Spacer(Modifier.height(12.dp))
                    Destination.entries.forEach { item ->
                        NavigationRailItem(
                            selected = destination == item,
                            onClick = { destination = item },
                            icon = { DestinationIcon(item) },
                            label = { Text(item.label) }
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    FloatingActionButton(onClick = { vm.edit(null) }, modifier = Modifier.padding(12.dp)) { Icon(Icons.Outlined.Add, "Adicionar") }
                }
                AppContent(destination, state, snackbar, vm, Modifier.weight(1f))
            }
        } else {
            Scaffold(
                modifier = Modifier.fillMaxSize(),
                contentWindowInsets = WindowInsets.safeDrawing,
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = { TopAppBar(title = { Text(destination.label) }) },
                floatingActionButton = { FloatingActionButton(onClick = { vm.edit(null) }) { Icon(Icons.Outlined.Add, "Adicionar lançamento") } },
                bottomBar = {
                    NavigationBar(containerColor = Graphite, tonalElevation = 0.dp) {
                        Destination.entries.forEach { item ->
                            NavigationBarItem(
                                selected = destination == item,
                                onClick = { destination = item },
                                icon = { DestinationIcon(item) },
                                label = { Text(item.label) },
                                colors = NavigationBarItemDefaults.colors(selectedIconColor = Violet, selectedTextColor = Violet, indicatorColor = Color.Transparent, unselectedIconColor = Muted, unselectedTextColor = Muted)
                            )
                        }
                    }
                }
            ) { padding -> AppBody(destination, state, vm, Modifier.padding(padding)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppContent(destination: Destination, state: FinanceState, snackbar: SnackbarHostState, vm: FinanceViewModel, modifier: Modifier) {
    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { TopAppBar(title = { Text(destination.label) }) }
    ) { padding -> AppBody(destination, state, vm, Modifier.padding(padding)) }
}

@Composable
private fun DestinationIcon(destination: Destination) {
    val icon = when (destination) {
        Destination.Overview -> Icons.Outlined.Home
        Destination.Transactions -> Icons.Outlined.ReceiptLong
        Destination.More -> Icons.Outlined.MoreHoriz
    }
    Icon(icon, destination.label)
}

@Composable
private fun AppBody(destination: Destination, state: FinanceState, vm: FinanceViewModel, modifier: Modifier) {
    Box(modifier.fillMaxSize()) {
        when (destination) {
            Destination.Overview -> OverviewScreen(state, vm)
            Destination.Transactions -> TransactionsScreen(state, vm)
            Destination.More -> MoreScreen(state, vm)
        }
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
    }
}

@Composable
private fun OverviewScreen(state: FinanceState, vm: FinanceViewModel) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 104.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Text("Olá, " + (state.account?.name ?: "") + ".", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Text("Seu mês, sem complicação.", color = Muted)
        }
        item { SummaryCards(state.summary) }
        item { Text("Últimos lançamentos", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        items(state.transactions.take(5), key = { it.id }) { row -> TransactionRow(row) { vm.select(row) } }
        if (state.transactions.isEmpty() && !state.loading) item { EmptyState("Nenhum lançamento neste mês.") }
        if (state.summary.byCategory.isNotEmpty()) {
            item { Text("Despesas por categoria", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
            items(state.summary.byCategory.entries.sortedByDescending { it.value }) { entry ->
                ListItem(headlineContent = { Text(entry.key) }, trailingContent = { Text(money(entry.value), fontWeight = FontWeight.SemiBold) })
            }
        }
    }
}

@Composable
private fun SummaryCards(summary: Summary) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = VioletContainer), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp)) {
                Text("Saldo do mês", color = Muted)
                Text(money(summary.balance), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MetricCard("Receitas", summary.income, Income, Modifier.weight(1f))
            MetricCard("Despesas", summary.expense, Expense, Modifier.weight(1f))
        }
    }
}

@Composable
private fun MetricCard(label: String, value: BigDecimal, color: Color, modifier: Modifier) {
        Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = Surface), shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(label, color = Muted)
            Text(money(value), color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun TransactionsScreen(state: FinanceState, vm: FinanceViewModel) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 104.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(state.transactions.size.toString() + " registros", color = Muted)
                TextButton(onClick = vm::refresh) { Text("Atualizar") }
            }
        }
        items(state.transactions, key = { it.id }) { row -> TransactionRow(row) { vm.select(row) } }
        if (state.transactions.isEmpty() && !state.loading) item { EmptyState("Nenhum lançamento encontrado.") }
    }
}

@Composable
private fun TransactionRow(row: FinanceTransaction, onClick: () -> Unit) {
    Surface(
        color = Surface,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (row.type == "receita") Icons.Outlined.TrendingUp else Icons.Outlined.TrendingDown,
                contentDescription = if (row.type == "receita") "Receita" else "Despesa",
                tint = if (row.type == "receita") Income else Expense
            )
            Column(Modifier.weight(1f)) {
                Text(row.description, fontWeight = FontWeight.SemiBold, maxLines = 2)
                Text(row.category + " · " + formatDate(row.date), color = Muted, style = MaterialTheme.typography.bodySmall)
                Text(if (row.owner) "Meu lançamento" else "Compartilhado comigo", color = Muted, style = MaterialTheme.typography.labelSmall)
            }
            Text(
                (if (row.type == "receita") "+ " else "− ") + money(row.amount),
                color = if (row.type == "receita") Income else Expense,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TransactionActions(row: FinanceTransaction, vm: FinanceViewModel) {
    ModalBottomSheet(onDismissRequest = { vm.select(null) }) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp, 4.dp, 20.dp, 20.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(row.description, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(money(row.amount) + " · " + formatDate(row.date), color = Muted)
            Spacer(Modifier.height(12.dp))
            ActionButton(Icons.Outlined.Edit, "Editar lançamento") { vm.edit(row) }
            ActionButton(if (row.shared) Icons.Outlined.SyncDisabled else Icons.Outlined.Share, if (row.shared) "Parar de compartilhar" else "Compartilhar lançamento") { vm.toggleShare(row) }
            ActionButton(Icons.Outlined.Delete, "Excluir lançamento", destructive = true) { vm.requestDelete(row) }
        }
    }
}

@Composable
private fun ActionButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, destructive: Boolean = false, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), colors = ButtonDefaults.textButtonColors(contentColor = if (destructive) Expense else Text)) {
        Icon(icon, null)
        Spacer(Modifier.width(12.dp))
        Text(label, Modifier.weight(1f))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TransactionEditor(row: FinanceTransaction?, categories: List<String>, vm: FinanceViewModel) {
    val context = LocalContext.current
    var imageUri by remember(row) { mutableStateOf<Uri?>(null) }
    var newCategory by remember { mutableStateOf("") }
    var categoryDialog by remember { mutableStateOf(false) }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { imageUri = it }
    var type by remember(row) { mutableStateOf(row?.type ?: "despesa") }
    var amount by remember(row) { mutableStateOf(row?.amount?.toPlainString().orEmpty()) }
    var category by remember(row) { mutableStateOf(row?.category ?: categories.first()) }
    var description by remember(row) { mutableStateOf(row?.description.orEmpty()) }
    var date by remember(row) { mutableStateOf(row?.date ?: LocalDate.now().toString()) }
    var categoryOpen by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = vm::closeEditor,
        title = { Text(if (row == null) "Novo lançamento" else "Editar lançamento") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf("despesa" to "Despesa", "receita" to "Receita").forEachIndexed { index, pair ->
                        SegmentedButton(selected = type == pair.first, onClick = { type = pair.first }, shape = SegmentedButtonDefaults.itemShape(index, 2)) { Text(pair.second) }
                    }
                }
                OutlinedTextField(amount, { amount = it }, Modifier.fillMaxWidth(), label = { Text("Valor") }, singleLine = true)
                Box {
                    OutlinedButton(onClick = { categoryOpen = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(category, Modifier.weight(1f)) }
                    DropdownMenu(categoryOpen, { categoryOpen = false }) {
                        categories.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { category = option; categoryOpen = false }) }
                        DropdownMenuItem(text = { Text("+ Nova categoria") }, onClick = { categoryOpen = false; categoryDialog = true })
                    }
                }
                OutlinedButton(onClick = { imagePicker.launch("image/*") }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (imageUri == null) "Adicionar imagem do comprovante" else "Imagem selecionada") }
                OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descrição") }, singleLine = true)
                OutlinedTextField(date, { date = it }, Modifier.fillMaxWidth(), label = { Text("Data (AAAA-MM-DD)") }, singleLine = true)
            }
        },
        confirmButton = { Button(onClick = { vm.save(TransactionDraft(type, amount, category, description, date), imageUri, context) }) { Text("Salvar") } },
        dismissButton = { TextButton(onClick = vm::closeEditor) { Text("Cancelar") } }
    )
    if (categoryDialog) AlertDialog(onDismissRequest = { categoryDialog = false }, title = { Text("Nova categoria") }, text = { OutlinedTextField(newCategory, { newCategory = it }, label = { Text("Nome") }, singleLine = true) }, confirmButton = { Button(onClick = { if (newCategory.trim().length >= 2) { vm.addCategory(newCategory); category = newCategory.trim(); newCategory = ""; categoryDialog = false } }) { Text("Adicionar") } }, dismissButton = { TextButton(onClick = { categoryDialog = false }) { Text("Cancelar") } })
}

@Composable
private fun DeleteConfirmation(row: FinanceTransaction, vm: FinanceViewModel) {
    AlertDialog(
        onDismissRequest = vm::cancelDelete,
        icon = { Icon(Icons.Outlined.Delete, null, tint = Expense) },
        title = { Text("Excluir lançamento?") },
        text = { Text("“" + row.description + "” será movido para a lixeira e poderá ser restaurado por até 30 dias.") },
        confirmButton = { Button(onClick = vm::deleteConfirmed, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text("Excluir") } },
        dismissButton = { TextButton(onClick = vm::cancelDelete) { Text("Cancelar") } }
    )
}

@Composable
private fun MoreScreen(state: FinanceState, vm: FinanceViewModel) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 104.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(state.account?.name ?: "Minha conta", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text("@" + (state.account?.username ?: ""), color = Muted)
                    Text(if (state.account?.telegramLinked == true) "Telegram conectado" else "Telegram ainda não conectado", color = Muted)
                }
            }
        }
        item {
            OutlinedButton(onClick = vm::logout, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Sair da conta") }
        }
        item {
            Text("Próximos módulos", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("Lembretes, relatórios avançados, perfil com foto e notificações nativas serão integrados nesta mesma estrutura Compose.", color = Muted)
        }
    }
}

@Composable
private fun EmptyState(text: String) {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Text(text, color = Muted) }
}

private fun money(value: BigDecimal): String = NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(value)
private fun formatDate(value: String): String = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd/MM/yyyy")) }.getOrDefault(value)

