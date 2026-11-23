package app.xeniabridge

import android.app.Application

/** Startet mit jedem Prozess (App, Widget-Update, Wecker): Widgets beim Einschalten des Bildschirms aktualisieren */
class XeniaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Widgets.watchScreen(this)
    }
}
