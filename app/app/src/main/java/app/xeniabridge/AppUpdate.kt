package app.xeniabridge

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * App-Update aus den GitHub-Releases: Das neueste Release liefert `Xenios-<Build>.apk`. Ist die Build-Nummer höher als
 * die installierte, lädt die App die APK in den Cache und installiert sie über den PackageInstaller. Ab Android 12 ohne
 * Rückfrage, solange Android die Bedingungen dafür als erfüllt ansieht (siehe docs/Android-App.md, „App-Update“).
 */
object AppUpdate {
    private const val REPO = "TimS1998/Xenios"
    private const val LATEST_URL = "https://api.github.com/repos/$REPO/releases/latest"
    /** Nur Assets aus den Releases dieses Repos */
    private const val DOWNLOAD_PREFIX = "https://github.com/$REPO/releases/download/"
    private val ASSET = Regex("""Xenios-(\d+)\.apk""")
    private val SHA256 = Regex("[0-9a-f]{64}")
    private val UA = "Xenios-App/${BuildConfig.VERSION_CODE} (+https://github.com/$REPO)"
    private const val DAY = 24 * 3600_000L
    private const val HOUR = 3600_000L
    private const val MAX_SIZE = 200L * 1024 * 1024
    /** So lange nach dem Öffnen von „Unbekannte Apps installieren“ geht es nach der Rückkehr von selbst weiter */
    private const val RESUME_WINDOW = 10 * 60_000L

    /** Neuestes Release mit APK, wie es GitHub meldet. */
    private class Release(val build: Long, val tag: String, val url: String, val size: Long, val sha256: String?) {
        /** Wie versionName der App: „2.5.0 (412)“ */
        val label: String get() = "${tag.removePrefix("v")} ($build)"
        val newer: Boolean get() = build > BuildConfig.VERSION_CODE
        fun toJson(): String = JSONObject().put("build", build).put("tag", tag).put("url", url).put("size", size)
            .put("sha256", sha256 ?: JSONObject.NULL).toString()
    }

    private fun parse(json: String?): Release? = try {
        json?.let { JSONObject(it) }?.let { Release(it.getLong("build"), it.getString("tag"), it.getString("url"), it.getLong("size"), it.optString("sha256").takeIf { s -> SHA256.matches(s) }) }
    } catch (_: Exception) {
        null
    }

    // Laufender Vorgang, nur im Speicher: "" (nichts), "checking", "downloading", "installing"
    @Volatile private var phase = ""
    @Volatile private var progress = 0
    @Volatile private var error: String? = null
    /** Letzter automatischer Versuch (auch erfolglos), damit offline nicht bei jedem Öffnen erneut gefragt wird */
    @Volatile private var lastTry = 0L
    /** Bestätigung der Installation, die Android verlangt hat, während die App nicht sichtbar war */
    @Volatile private var pendingConfirm: Intent? = null
    private val worker = Executors.newSingleThreadExecutor()

    /** Meldet Änderungen an die offene App (MainActivity), damit die Einstellungen neu zeichnen. */
    @Volatile var onChange: (() -> Unit)? = null
    private fun changed() = onChange?.invoke()

    /** Stand für die Web-Oberfläche (JSON). */
    fun state(context: Context): String {
        val prefs = Prefs(context)
        val latest = parse(prefs.updateRelease)
        return JSONObject()
            .put("installed", BuildConfig.VERSION_NAME)
            .put("installedBuild", BuildConfig.VERSION_CODE)
            .put("latest", latest?.label ?: JSONObject.NULL)
            .put("latestBuild", latest?.build ?: 0L)
            .put("available", latest?.newer == true)
            .put("announced", prefs.updateAnnounced)
            .put("checkedAt", prefs.updateCheckedAt)
            .put("phase", phase)
            .put("progress", progress)
            .put("error", error ?: JSONObject.NULL)
            .put("allowed", context.packageManager.canRequestPackageInstalls())
            .toString()
    }

    /** Beim Öffnen der App: nach erteilter Erlaubnis weiterinstallieren, ausstehende Bestätigung zeigen, täglich prüfen. */
    fun resume(activity: Activity) {
        val prefs = Prefs(activity)
        pendingConfirm?.let { pendingConfirm = null; showConfirm(activity, it) }
        val asked = prefs.updateInstallAsked
        if (asked > 0 && activity.packageManager.canRequestPackageInstalls()) {
            prefs.updateInstallAsked = 0
            if (System.currentTimeMillis() - asked < RESUME_WINDOW) install(activity)
        }
        changed() // die Erlaubnis kann sich in den Android-Einstellungen geändert haben
        val now = System.currentTimeMillis()
        if (now - prefs.updateCheckedAt >= DAY && now - lastTry >= HOUR) check(activity, manual = false)
    }

    /** Neuestes Release abfragen. Automatisch still (offline, Rate-Limit); auf Knopfdruck mit Grund in der Oberfläche. */
    @Synchronized
    fun check(context: Context, manual: Boolean) {
        if (phase.isNotEmpty()) return
        val app = context.applicationContext
        lastTry = System.currentTimeMillis()
        if (manual) {
            phase = "checking"
            error = null
            changed()
        }
        worker.execute {
            try {
                val latest = fetchLatest()
                val prefs = Prefs(app)
                prefs.updateRelease = latest?.toJson()
                prefs.updateCheckedAt = System.currentTimeMillis()
                // Nichts Neueres: geladene APKs früherer Updates wegräumen
                if (latest?.newer != true) File(app.cacheDir, "update").deleteRecursively()
                if (manual) error = null
            } catch (e: Exception) {
                if (manual) error = message(e)
            } finally {
                if (manual) phase = ""
                changed()
            }
        }
    }

    private fun fetchLatest(): Release? {
        val conn = URL(LATEST_URL).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8000
            conn.readTimeout = 10_000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("User-Agent", UA)
            when (val code = conn.responseCode) {
                200 -> Unit
                404 -> return null // noch kein Release
                403, 429 -> throw IOException("GitHub bremst gerade, später erneut versuchen")
                else -> throw IOException("GitHub antwortet HTTP $code")
            }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val assets = json.optJSONArray("assets") ?: return null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                val build = ASSET.matchEntire(a.optString("name"))?.groupValues?.get(1)?.toLongOrNull() ?: continue
                val url = a.optString("browser_download_url")
                if (!url.startsWith(DOWNLOAD_PREFIX, ignoreCase = true) || url.contains("..")) continue
                // GitHub nennt die SHA-256 der Datei („sha256:…“); fehlt sie, bleibt die Prüfung der Signatur
                val sha = a.optString("digest").removePrefix("sha256:").takeIf { SHA256.matches(it) }
                return Release(build, json.optString("tag_name"), url, a.optLong("size"), sha)
            }
            return null
        } finally {
            conn.disconnect()
        }
    }

    /** Neue APK laden und installieren. Fehlt „Unbekannte Apps installieren“, erst dorthin führen. */
    @Synchronized
    fun install(activity: Activity) {
        if (phase.isNotEmpty()) return
        val prefs = Prefs(activity)
        val release = parse(prefs.updateRelease)?.takeIf { it.newer } ?: return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            prefs.updateInstallAsked = System.currentTimeMillis()
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            } catch (_: Exception) {
                error = "Einstellung „Unbekannte Apps installieren“ nicht gefunden"
                changed()
            }
            return
        }
        prefs.updateInstallAsked = 0
        phase = "downloading"
        progress = 0
        error = null
        changed()
        val app = activity.applicationContext
        worker.execute {
            try {
                val apk = download(app, release)
                verify(app, apk, release)
                phase = "installing"
                changed()
                commit(app, apk)
                // Weiter geht es in onStatus; bei Erfolg beendet Android die App, um sie zu ersetzen
            } catch (e: Exception) {
                phase = ""
                error = message(e)
                changed()
            }
        }
    }

    private fun download(context: Context, r: Release): File {
        if (r.size !in 1..MAX_SIZE) throw IOException("GitHub meldet eine unerwartete Größe der APK")
        val dir = File(context.cacheDir, "update").apply { mkdirs() }
        val file = File(dir, "Xenios-${r.build}.apk")
        dir.listFiles()?.forEach { if (it != file) it.delete() }
        // Schon geladen (z. B. Bestätigung vorhin abgebrochen)?
        if (file.length() == r.size && (r.sha256 == null || sha256(file) == r.sha256)) return file
        val part = File(dir, "${file.name}.part")
        val conn = URL(r.url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("User-Agent", UA)
            // github.com leitet zum Download-Server von GitHub weiter (HttpURLConnection folgt nur https → https)
            if (conn.responseCode != 200) throw IOException("Download: HTTP ${conn.responseCode}")
            val md = MessageDigest.getInstance("SHA-256")
            var done = 0L
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        done += n
                        if (done > r.size) throw IOException("APK größer als angekündigt")
                        md.update(buf, 0, n)
                        out.write(buf, 0, n)
                        val p = (done * 100 / r.size).toInt()
                        if (p != progress) { progress = p; changed() }
                    }
                }
            }
            if (done != r.size) throw IOException("Download unvollständig")
            if (r.sha256 != null && hex(md.digest()) != r.sha256) throw IOException("Prüfsumme der APK stimmt nicht mit dem Release überein")
            if (!part.renameTo(file)) throw IOException("APK ließ sich nicht speichern")
            return file
        } finally {
            conn.disconnect()
            part.delete()
        }
    }

    /**
     * Nur eine APK dieser App mit der Build-Nummer aus dem Release und demselben Signaturschlüssel. Den Schlüssel prüft
     * Android bei der Installation ohnehin; hier gibt es dafür eine verständliche Meldung.
     */
    private fun verify(context: Context, apk: File, r: Release) {
        val pm = context.packageManager
        val info = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: throw IOException("APK nicht lesbar")
        if (info.packageName != context.packageName) throw IOException("Die APK gehört zu einer anderen App")
        if (info.longVersionCode != r.build) throw IOException("Build-Nummer der APK passt nicht zum Release")
        val si = info.signingInfo ?: return // manche Android-Versionen lesen die Signatur eines Archivs nicht
        val theirs = (if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory)?.toSet().orEmpty()
        val own = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners?.toSet().orEmpty()
        if (theirs.isNotEmpty() && own.isNotEmpty() && own.none { it in theirs }) {
            throw IOException("Die APK ist mit einem anderen Schlüssel signiert als diese App (selbst gebaut?). Einmal von Hand aus dem Release installieren.")
        }
    }

    private fun commit(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            setInstallReason(PackageManager.INSTALL_REASON_USER)
            // Ab Android 12: Update der App durch sich selbst ohne Rückfrage (braucht UPDATE_PACKAGES_WITHOUT_USER_ACTION)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            if (Build.VERSION.SDK_INT >= 33) setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                // Explizit an den eigenen Receiver; MUTABLE, weil Android Status und Bestätigungs-Intent einträgt
                val status = Intent(context, UpdateReceiver::class.java)
                val pi = PendingIntent.getBroadcast(context, id, status, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                session.commit(pi.intentSender)
            }
        } catch (e: Exception) {
            runCatching { installer.abandonSession(id) }
            throw e
        }
    }

    /** Ergebnis des PackageInstallers. */
    internal fun onStatus(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Android verlangt doch eine Bestätigung (siehe docs/Android-App.md, wann das passiert)
                @Suppress("DEPRECATION")
                val dialog: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (dialog == null) return finish("Android verlangt eine Bestätigung, liefert aber keinen Dialog")
                // Nur in der sichtbaren App öffnen; sonst beim nächsten Öffnen
                if (Widgets.appVisible) showConfirm(context, dialog) else { pendingConfirm = dialog }
            }
            PackageInstaller.STATUS_SUCCESS -> finish(null)
            PackageInstaller.STATUS_FAILURE_ABORTED -> finish("Installation abgebrochen")
            else -> finish("Installation fehlgeschlagen: " + (intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "unbekannter Grund"))
        }
    }

    private fun showConfirm(context: Context, dialog: Intent) {
        try {
            context.startActivity(dialog.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            finish("Bestätigung ließ sich nicht öffnen: ${e.message}")
        }
    }

    private fun finish(message: String?) {
        phase = ""
        error = message
        changed()
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return hex(md.digest())
    }

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    private fun message(e: Exception): String = when (e) {
        is java.net.UnknownHostException, is java.net.ConnectException, is java.net.SocketTimeoutException -> "Keine Verbindung zu GitHub"
        else -> e.message ?: e.javaClass.simpleName
    }
}

/** Ergebnis der Installation (PackageInstaller-Session): Bestätigung zeigen, Abbruch oder Fehler melden. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = AppUpdate.onStatus(context, intent)
}
