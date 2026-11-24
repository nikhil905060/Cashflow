package com.cashflow.os

import android.Manifest
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.biometric.BiometricPrompt
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : FragmentActivity() {

    private lateinit var webView: WebView
    private var speechRecognizer: SpeechRecognizer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
        }

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(CashFlowBridge(), "AndroidNative")
        webView.loadUrl("file:///android_asset/index.html")

        TransactionNotificationService.onNewTransactionCallback = {
            runOnUiThread {
                webView.evaluateJavascript("if(window.onAutoTransactionsReady) window.onAutoTransactionsReady();", null)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.evaluateJavascript("if(window.onAutoTransactionsReady) window.onAutoTransactionsReady();", null)
            webView.evaluateJavascript("if(window.refreshAutoDetectStatus) window.refreshAutoDetectStatus();", null)
        }
    }

    override fun onDestroy() {
        TransactionNotificationService.onNewTransactionCallback = null
        speechRecognizer?.destroy()
        super.onDestroy()
    }

    private fun hasNotificationListenerPermission(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val expected = ComponentName(this, TransactionNotificationService::class.java).flattenToString()
        return enabled.split(":").any { it.equals(expected, ignoreCase = true) || it.contains(packageName) }
    }

    inner class CashFlowBridge {

        @JavascriptInterface
        fun isNotificationAccessEnabled(): Boolean {
            return hasNotificationListenerPermission()
        }

        @JavascriptInterface
        fun isAutoDetectEnabled(): Boolean {
            return TransactionNotificationService.isEnabled(applicationContext)
        }

        @JavascriptInterface
        fun setAutoDetectEnabled(enabled: Boolean) {
            TransactionNotificationService.setEnabled(applicationContext, enabled)
        }

        @JavascriptInterface
        fun openNotificationSettings() {
            runOnUiThread {
                try {
                    startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                } catch (e: Exception) {
                    openAppDetailsSettings()
                }
            }
        }

        @JavascriptInterface
        fun openAppDetailsSettings() {
            runOnUiThread {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", packageName, null)
                }
                startActivity(intent)
            }
        }

        @JavascriptInterface
        fun consumeAutoTransactions(): String {
            return TransactionNotificationService.consumeQueueJson(applicationContext)
        }

        @JavascriptInterface
        fun simulateTestTransaction(type: String, amount: Double, party: String) {
            val item = JSONObject().apply {
                put("type", type)
                put("amount", amount)
                put("accountHint", "UPI")
                put("note", if (type == "CREDIT") "Received from $party" else "Paid to $party")
                put("tsMs", System.currentTimeMillis())
            }
            TransactionNotificationService.enqueueParsedTx(applicationContext, item)
            runOnUiThread {
                webView.evaluateJavascript("if(window.onAutoTransactionsReady) window.onAutoTransactionsReady();", null)
            }
        }

        @JavascriptInterface
        fun triggerBiometric() {
            runOnUiThread {
                val executor = ContextCompat.getMainExecutor(this@MainActivity)
                val prompt = BiometricPrompt(
                    this@MainActivity,
                    executor,
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            webView.evaluateJavascript("window.onNativeUnlock()", null)
                        }
                    }
                )
                val info = BiometricPrompt.PromptInfo.Builder()
                    .setTitle("Unlock Cash Flow OS")
                    .setSubtitle("Use fingerprint to unlock")
                    .setNegativeButtonText("Use 4-Digit PIN")
                    .build()
                prompt.authenticate(info)
            }
        }

        @JavascriptInterface
        fun startVoiceInput() {
            runOnUiThread {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED
                ) {
                    ActivityCompat.requestPermissions(
                        this@MainActivity,
                        arrayOf(Manifest.permission.RECORD_AUDIO),
                        201
                    )
                    return@runOnUiThread
                }

                speechRecognizer?.destroy()
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this@MainActivity)
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                }

                speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                    override fun onResults(results: Bundle?) {
                        val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val spoken = list?.firstOrNull()?.replace("'", "\\'") ?: ""
                        if (spoken.isNotEmpty()) {
                            webView.evaluateJavascript("window.onVoiceResult('$spoken')", null)
                        }
                    }
                    override fun onError(error: Int) {
                        webView.evaluateJavascript("window.onVoiceError()", null)
                    }
                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}
                    override fun onPartialResults(partialResults: Bundle?) {}
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
                speechRecognizer?.startListening(intent)
            }
        }

        @JavascriptInterface
        fun saveDailyBackup(jsonStr: String): String {
            return try {
                val dateTag = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
                val fileName = "cashflow_backup_$dateTag.json"

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val resolver = contentResolver
                    val contentValues = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                        put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
                        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/CashFlowOS_Backups")
                    }
                    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                    if (uri != null) {
                        resolver.openOutputStream(uri)?.use { out ->
                            out.write(jsonStr.toByteArray())
                        }
                        "Downloads/CashFlowOS_Backups/$fileName"
                    } else {
                        "ERR: Could not create MediaStore entry"
                    }
                } else {
                    val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    val folder = File(downloads, "CashFlowOS_Backups")
                    if (!folder.exists()) folder.mkdirs()
                    val file = File(folder, fileName)
                    file.writeText(jsonStr)
                    file.absolutePath
                }
            } catch (e: Exception) {
                "ERR: ${e.message}"
            }
        }
    }
}
