package com.cashflow.os

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Environment
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
    }

    inner class CashFlowBridge {

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
                val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val folder = File(downloads, "CashFlowOS_Backups")
                if (!folder.exists()) folder.mkdirs()
                val dateTag = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
                val file = File(folder, "cashflow_backup_$dateTag.json")
                file.writeText(jsonStr)
                file.absolutePath
            } catch (e: Exception) {
                "ERR: ${e.message}"
            }
        }
    }
}
