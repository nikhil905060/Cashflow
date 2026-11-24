package com.cashflow.os

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.regex.Pattern

class TransactionNotificationService : NotificationListenerService() {

    companion object {
        const val PREF_NAME = "cashflow_auto_prefs"
        const val KEY_QUEUE = "pending_tx_queue"
        const val KEY_ENABLED = "auto_detect_enabled"
        const val KEY_RECENT = "recent_dedup_map"
        val QUEUE_LOCK = Any()

        @Volatile
        var onNewTransactionCallback: (() -> Unit)? = null

        private val BLOCKED_PACKAGES = setOf(
            "com.cashflow.os",
            "com.whatsapp",
            "com.whatsapp.w4b",
            "org.telegram.messenger",
            "com.instagram.android",
            "com.snapchat.android",
            "com.facebook.orca",
            "com.facebook.katana",
            "com.discord",
            "com.google.android.youtube",
            "com.android.chrome",
            "com.android.systemui",
            "android"
        )

        private val IGNORE_REGEX = Pattern.compile(
            "\\b(otp|one time password|verification|verify|mpin|login|collect request|has requested|requested you|requesting|pay now|bill due|upcoming|offer|cashback up|upto|up to|win |won |flat \\d|discount|voucher|coupon|pre-approved|loan offer|emi due|autopay reminder|declined|failed|unsuccessful|insufficient|pending|expired|cancelled|canceled|reversed attempt)\\b",
            Pattern.CASE_INSENSITIVE
        )

        private val AMOUNT_REGEX = Pattern.compile(
            "(?:₹|rs\\.?|inr)\\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)|([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|inr)",
            Pattern.CASE_INSENSITIVE
        )

        private val CREDIT_REGEX = Pattern.compile(
            "\\b(credited|received|deposited|refunded|refund of|added to|sent you|paid you|cashback of|cr\\.?\\b)",
            Pattern.CASE_INSENSITIVE
        )

        private val DEBIT_REGEX = Pattern.compile(
            "\\b(debited|paid to|sent to|spent|deducted|withdrawn|transferred to|paid ₹|paid rs|paid inr|debited by|debited for|purchase of|dr\\.?\\b)",
            Pattern.CASE_INSENSITIVE
        )

        private val PARTY_REGEX = Pattern.compile(
            "(?:paid to|sent to|transferred to|to|from|at|by)\\s+([A-Za-z][A-Za-z0-9 &._-]{1,28}?)(?=\\s+(?:on|via|using|through|ref|upi|a/c|ac|acct|avl|bal|for|with|from|at|$)|[.,;]|$)",
            Pattern.CASE_INSENSITIVE
        )

        fun isEnabled(ctx: Context): Boolean {
            return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .getBoolean(KEY_ENABLED, true)
        }

        fun setEnabled(ctx: Context, enabled: Boolean) {
            ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_ENABLED, enabled).apply()
        }

        fun consumeQueueJson(ctx: Context): String {
            synchronized(QUEUE_LOCK) {
                val prefs = ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                val raw = prefs.getString(KEY_QUEUE, "[]") ?: "[]"
                prefs.edit().putString(KEY_QUEUE, "[]").apply()
                return raw
            }
        }

        fun enqueueParsedTx(ctx: Context, obj: JSONObject): Boolean {
            synchronized(QUEUE_LOCK) {
                val prefs = ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                val now = obj.optLong("tsMs", System.currentTimeMillis())
                val type = obj.optString("type", "DEBIT")
                val amt = obj.optDouble("amount", 0.0)
                val dedupKey = "${type}_${String.format(Locale.US, "%.2f", amt)}"

                val recentJson = JSONObject(prefs.getString(KEY_RECENT, "{}") ?: "{}")
                val lastSeen = recentJson.optLong(dedupKey, 0L)
                if (now - lastSeen in 0..90_000L) {
                    return false // Duplicate alert within 90s (e.g. UPI app + Bank SMS)
                }

                // Prune entries older than 5 minutes
                val cleaned = JSONObject()
                val keys = recentJson.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val t = recentJson.optLong(k, 0L)
                    if (now - t < 300_000L) cleaned.put(k, t)
                }
                cleaned.put(dedupKey, now)

                val arr = try {
                    JSONArray(prefs.getString(KEY_QUEUE, "[]") ?: "[]")
                } catch (e: Exception) {
                    JSONArray()
                }
                arr.put(obj)

                prefs.edit()
                    .putString(KEY_QUEUE, arr.toString())
                    .putString(KEY_RECENT, cleaned.toString())
                    .apply()
                return true
            }
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || !isEnabled(applicationContext)) return
        val pkg = sbn.packageName ?: return
        if (BLOCKED_PACKAGES.contains(pkg)) return
        if (sbn.isOngoing) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim() ?: ""
        val shortText = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
        val body = if (bigText.length >= shortText.length) bigText else shortText
        val combined = "$title $body".trim()
        if (combined.length < 8) return

        // Reject OTPs, promo offers, failed payments, collect requests
        if (IGNORE_REGEX.matcher(combined).find()) return

        // Extract amount
        val amtMatcher = AMOUNT_REGEX.matcher(combined)
        if (!amtMatcher.find()) return
        val rawNum = (amtMatcher.group(1) ?: amtMatcher.group(2) ?: "").replace(",", "")
        val amount = rawNum.toDoubleOrNull() ?: return
        if (amount <= 0.0 || amount > 10_000_000.0) return

        // Determine Credit vs Debit
        val lower = combined.lowercase(Locale.US)
        val hasCredit = CREDIT_REGEX.matcher(combined).find()
        val hasDebit = DEBIT_REGEX.matcher(combined).find()
        if (!hasCredit && !hasDebit) return

        val txType = when {
            hasCredit && !hasDebit -> "CREDIT"
            hasDebit && !hasCredit -> "DEBIT"
            lower.indexOf("credit") in 0 until lower.indexOf("debit").let { if (it < 0) Int.MAX_VALUE else it } -> "CREDIT"
            else -> "DEBIT"
        }

        val accountHint = detectAccountHint(lower, pkg)
        val party = extractParty(body.ifEmpty { combined })
        val note = buildNote(txType, party, accountHint)

        val item = JSONObject().apply {
            put("type", txType)
            put("amount", amount)
            put("accountHint", accountHint)
            put("note", note)
            put("rawTitle", title.take(60))
            put("tsMs", if (sbn.postTime > 0L) sbn.postTime else System.currentTimeMillis())
        }

        if (enqueueParsedTx(applicationContext, item)) {
            onNewTransactionCallback?.invoke()
        }
    }

    private fun detectAccountHint(lower: String, pkg: String): String {
        return when {
            lower.contains("sbi") || lower.contains("state bank") -> "SBI"
            lower.contains("union") -> "Union"
            lower.contains("gramin") || lower.contains("shgb") -> "SHGB"
            lower.contains("hdfc") -> "HDFC"
            lower.contains("icici") -> "ICICI"
            lower.contains("axis") -> "Axis"
            lower.contains("pnb") || lower.contains("punjab national") -> "PNB"
            lower.contains("kotak") -> "Kotak"
            lower.contains("bob") || lower.contains("baroda") -> "BOB"
            lower.contains("slice") || pkg.contains("slice") -> "Slice"
            lower.contains("fam") || pkg.contains("fampay") -> "FamPay"
            pkg.contains("phonepe") -> "PhonePe"
            pkg.contains("paisa") -> "GPay"
            pkg.contains("paytm") -> "Paytm"
            else -> "UPI"
        }
    }

    private fun extractParty(text: String): String {
        val m = PARTY_REGEX.matcher(text)
        if (m.find()) {
            val candidate = (m.group(1) ?: "").trim()
            val bad = setOf("your", "account", "bank", "a/c", "upi", "wallet", "card", "the", "a", "an")
            if (candidate.length >= 2 && !bad.contains(candidate.lowercase(Locale.US))) {
                return candidate
            }
        }
        return ""
    }

    private fun buildNote(type: String, party: String, hint: String): String {
        return when {
            party.isNotEmpty() && type == "CREDIT" -> "Received from $party"
            party.isNotEmpty() -> "Paid to $party"
            type == "CREDIT" -> "Auto Credit ($hint)"
            else -> "Auto Debit ($hint)"
        }
    }
}
