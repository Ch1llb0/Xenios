# Android-App

Native App (Kotlin, ohne Fremd-Bibliotheken, ab Android 11) im Ordner [`app/`](../app). Sie zeigt die Web-App des eigenen Servers und ergänzt, was eine Web-App nicht kann:

| Funktion | Beschreibung |
|---|---|
| **App-Fenster** | Die komplette Web-App (Dashboard, Home, Skripte, Schalter, Paddle, Timer, Mühle, Einstellungen). Sie ist immer auf dem Stand des Servers, ohne App-Update. |
| **Dashboard (Tablet)** | Übersicht, hochkant und quer: Schalter (Ein/Eco/Aus, Dampf, „Ohne Dampf einschalten“), Status, Instrumente (Druck, Brühgruppe, Brühkessel, Dampf), Live-Druckkurve während eines Bezugs (erscheint dann ganz oben), letzter Bezug und Mahlvorgang, Bezüge pro Tag, Bezugszeiten, Mahlgewichte, Verlauf. Über das Regler-Symbol oben rechts lassen sich Kacheln ein-/ausblenden, verschieben und in Breite (1–3 Spalten oder ganze Breite) und Höhe (1–4 Zellen) einstellen; Kacheln einer Zeile sind gleich hoch. Die Auswahl gilt pro Gerät. Dort auch „Beim Start öffnen“ und „Bildschirm anlassen“ (für ein Tablet an der Wand). |
| **Widgets** | 12 Widgets, in der Auswahl in dieser Reihenfolge (siehe unten). Symbole wie die Kacheln auf Home; Farben, Formen, Schrift und Anzeigen folgen dem Design der App (Material oder Xenia, hell/dunkel). Titel „Xenios – Name“, wo Platz ist. |
| **Schnelleinstellungs-Kachel** | Im Benachrichtigungs-Schatten: zeigt Aus/Heizt auf/Bereit/Eco und schaltet Ein/Aus. Nach dem Tippen zeigt sie sofort „Schaltet ein/aus …“ und wartet auf die Bestätigung der Maschine; weitere Tipps werden so lange ignoriert. |
| **Wecker-Automatik** | Die App meldet dem Server den nächsten Wecker des Handys (Android stellt nur den nächsten bereit; die Uhr-App von Google und die meisten Wecker-Apps tragen ihn dort ein). Der Server schaltet die Maschine eine einstellbare Zeit vorher ein. Bei mehreren Handys zählt der früheste. Einstellungen: *Timer → Wecker* (an/aus, Vorlauf, Dampfkessel, frühester/spätester Wecker, Wochentage, welche Handys zählen). „Wecker prüfen“ meldet den Wecker des Handys, auf dem die App gerade offen ist, sofort; „Alle Wecker in der Uhr-App ansehen“ öffnet die Wecker-Liste. Eine vollständige Liste aller Wecker gibt Android anderen Apps nicht heraus. Einträge verschwinden von selbst, sobald die Anmeldung des Handys endet oder es einen Tag lang keinen künftigen Wecker gemeldet hat; abgewählte Handys bleiben stehen, solange ihre Anmeldung gilt. |
| **App-Shortcuts** | Langdruck auf das App-Symbol: Einschalten, Eco, Ausschalten (ohne die App zu öffnen), Timer und Dashboard. Manche Launcher zeigen nur vier davon, dann fehlt der letzte („Dashboard“). Für ein Tablet stattdessen im Dashboard „Beim Start öffnen“ einschalten. |

### Widgets

| Widget | Größe | Inhalt |
|---|---|---|
| **Ein/Aus** | 2×1 | Ein Tipp schaltet ein (aus Aus oder Eco) bzw. aus; „Ohne Dampf einschalten“ der App gilt. |
| **Ein ohne Dampf/Aus** | 2×1 | Ein Tipp schaltet ohne Dampfkessel ein bzw. aus, unabhängig von der Einstellung. |
| **Ein/Eco/Aus** | 4×1 | Wie das frühere schmale Widget: Zustand und Brühgruppe links, Ein, Eco und Aus rechts in einer Zeile. |
| **Kaffeemaschine groß** | 4×3 | Status (Brühgruppe, Dampf, nächstes geplantes Einschalten), Plaketten Tank, Dampf, Waage verbunden (alte Xenia), Bezüge heute; Ein/Eco/Aus, Dampfkessel, „Ohne Dampf einschalten“. |
| **Schalter** | 4×2 | Wie die Kachel „Schalter“: Ein/Eco/Aus, Dampfkessel, „Ohne Dampf einschalten“, Zustand oben rechts. |
| **Instrumente** | 4×2 (2×2 bei schmalem Widget) | Druck, Brühgruppe, Brühkessel, Dampfkessel mit Zielen – Manometer (Xenia) oder flache Anzeigen (Material). |
| **Verlauf (10 min)** | 4×2 | Temperaturen und Drücke der letzten 10 Minuten. |
| **Letzter Bezug** | 2×2 | Bezugszeit, Ausbeute, Verhältnis und Kurve. |
| **Bezüge** | 4×2 | Letzter Bezug und Bezüge pro Tag. |
| **Bezüge groß** | 4×3 | Letzter Bezug, Bezüge pro Tag und Bezugszeiten. |
| **Sollwerte** | 2×2 | Brühgruppe, Brühkessel und Dampfdruck mit −/+. |
| **Pflege** | 2×1 | Wann der nächste Backflush fällig ist. |

Alle Widgets lassen sich in der Größe ändern; gezeichnet wird für jede Größe ein eigenes, passendes Bild (nichts wird gestreckt). Die Klickflächen der Widgets erzeugt [`app/tools/widgets_gen.py`](../app/tools/widgets_gen.py) zusammen mit `WidgetSpecs.kt`.

**Schalten:** Nach einem Tipp zeigt das Widget sofort den erwarteten Zustand („Schaltet ein …“, der gedrückte Knopf ist hervorgehoben und pulsiert), bis die Maschine ihn meldet (jede Sekunde nachgesehen, höchstens 8 s). So lange werden weitere Tipps auf Schalter ignoriert. Sollwerte und „Ohne Dampf einschalten“ ändern sich ebenfalls sofort; schnelle Tipps auf −/+ addieren sich.

**Aktualisierung:** Bei eingeschaltetem Bildschirm alle 5 s (kürzer lässt Android für Wecker nicht zu), solange die App selbst nicht offen ist; ohne Verbindung nach 5, 10, 30 und dann alle 60 s. Bei ausgeschaltetem Bildschirm wird nichts abgefragt und das Handy nicht geweckt; beim Einschalten oder Entsperren aktualisieren sich die Widgets sofort. Für den 5-Sekunden-Takt braucht die App die Erlaubnis **„Wecker und Erinnerungen“** (`SCHEDULE_EXACT_ALARM`): bis Android 13 automatisch erteilt, ab Android 14 einmal zu erlauben. Liegt ein Widget auf dem Startbildschirm und fehlt die Erlaubnis, weist die App einmalig darauf hin; *Einstellungen → Widgets* zeigt den Stand und öffnet die Einstellung. Ohne Erlaubnis bündelt Android die Wecker und die Widgets aktualisieren sich langsamer. Klappt ein Update nicht, bleibt der letzte Stand stehen; erst nach mehreren Fehlschlägen zeigt das Widget den Fehler. „Offline“ heißt: Der Server erreicht die Maschine nicht (zweimal in Folge keine Antwort).

## Anmeldung und Sicherheit
- Beim ersten Start fragt die App nach der **Server-Adresse** (Cloudflare, z. B. `https://xenia.example.com`), optional einer **lokalen Adresse** (z. B. `http://192.168.178.32`) und dem **App-Passwort**. Mindestens eine Adresse ist nötig.
- Ist die lokale Adresse erreichbar (Handy im WLAN), nutzen App, Widgets und Kachel sie, sonst automatisch die Cloudflare-Adresse. Die Wahl wird alle 2 min und bei Verbindungsfehlern neu getroffen.
- Der Server legt dafür eine eigene Sitzung an (`POST /auth/device`). Sie erscheint unter *Einstellungen → Angemeldete Geräte* als `Android-App: <Gerätename>` und lässt sich dort widerrufen.
- Das Token liegt nur im app-privaten Speicher und ist vom Backup ausgeschlossen. Die WebView nutzt es als Cookie, Widgets und Kachel als `Authorization: Bearer`.
- Die Cloudflare-Adresse braucht **HTTPS mit gültigem Zertifikat**. **http** (unverschlüsselt) erlaubt die App nur für Adressen im eigenen Netz: private IPs (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) und Namen wie `*.fritz.box`, `*.local`. Im WLAN sind Passwort und Token damit im Klartext unterwegs, deshalb nur im eigenen, verschlüsselten WLAN nutzen. Das selbstsignierte Zertifikat auf Port 8443 akzeptiert die App nicht.
- Damit der Server unter `http://<PC-IP>/` antwortet, in `config.json` setzen: `"lan": { "enabled": true, "host": "0.0.0.0", "port": 80 }` und den Server neu starten. Die Windows-Firewall muss Node.js im privaten Netz erlauben (Standard-Abfrage beim ersten Start).
- **Cloudflare Access** (zusätzliche Anmeldeseite vor dem Tunnel) verträgt sich nicht mit Widgets: deren Aufrufe würden umgeleitet. Für die App den Tunnel ohne Access betreiben. Der Schutz übernimmt das App-Passwort mit Sperre gegen Durchprobieren.
- „Abmelden“ in der App oder ein widerrufenes Token führt zurück zur Anmeldung der App.

## Notbetrieb, wenn der Server ausfällt

Ist der Server nicht erreichbar, schaltet die App mit Server-Verbindung automatisch auf die Web-App aus der APK um und spricht die Maschine direkt an (wie im Direkt-Modus, nur im Heimnetz). Die IP der Maschine merkt sie sich vom Server. Widgets und Kachel schalten dann ebenfalls direkt. Ein Hinweis unten bietet „Server“ an, um es erneut über den Server zu versuchen. Zeitplan, Wecker-Automatik und das Bezugs-Protokoll des Servers gibt es im Notbetrieb nicht.

## Direkt-Modus (ohne Server, nur im Heimnetz)
Bei der Einrichtung „Direkt im Heimnetz“ wählen und dieselbe Umschaltung wie am Server: **Neue Xenia** (Brew-by-Sync) oder **Alte Xenia** (DBL / offizielle API). Die IP-Adressen von Maschine und optional der Mühle eintragen, dazu optional das Owner-Passwort der Mühle. Ohne Mühle bleiben Mühlen-Navigation, Kacheln und Grind-by-Sync aus; Dosis und Mahlgrad trägt man beim Bezug selbst ein. Bei der alten API blendet die App Paddle, den Wochenplan der Maschine und „Uhr stellen“ aus und zählt die Bezugszeit selbst. Die App bringt die Web-Oberfläche selbst mit und nutzt denselben Geräte-Code wie der Server (`public/shared/`). Sie spricht Maschine (http) und Mühle (https mit gemerktem Zertifikat) direkt an. Widgets, Kachel und Shortcuts funktionieren ebenfalls.

Ohne Server entfallen Push-Benachrichtigungen, die weiteren Schaltzeiten, das Einschalten vor dem Wecker und der Zugriff von unterwegs.

**IP-Adressen finden**
1. In der Einrichtung **„Im WLAN suchen“** tippen. Die App fragt alle Geräte im eigenen WLAN ab (x.x.x.1–254); ein Fortschrittsbalken zeigt, wie viele Adressen abgefragt und wie viele Geräte gefunden sind. Dieselbe Suche gibt es bei „Mit Server“ für den Xenios-Server (HTTPS Port 8443, HTTP 80/8080), jeweils mit Anleitung daneben.
2. Oder in der Fritz!Box: `fritz.box` → *Heimnetz → Netzwerk → Netzwerkverbindungen*. Die Maschine heißt meist **ESP32-…** bzw. **espressif**, die Mühle **hemro_hsg_…** (Hemro).
3. Bei beiden Geräten dort „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“ anhaken.
4. Prüfen: `http://<IP>/` zeigt die Xenia-Oberfläche. Für die Mühle `https://<IP>/` öffnen und die Zertifikatswarnung bestätigen.

## Noch nicht enthalten
- **Push-Benachrichtigungen** in der App. Die Web-App nutzt Web-Push, das in einer WebView nicht verfügbar ist. Native Push bräuchte Firebase Cloud Messaging. Bis dahin: Benachrichtigungen über die Web-App in Chrome.

## APK bauen

### Per GitHub Actions (empfohlen)
Der Workflow [`.github/workflows/app.yml`](../.github/workflows/app.yml) baut bei jeder Änderung in `app/` oder `server/web/` (oder manuell über *Actions → Android-App bauen → Run workflow*) eine signierte APK. Sie liegt danach als Artefakt **Xenios-APK** am Lauf.

**Releases:** Ein Tag `v*` (z. B. `git tag v2.0.0 && git push origin v2.0.0`) startet [`release.yml`](../.github/workflows/release.yml). Das erzeugt ein GitHub-Release mit der APK zum Herunterladen und veröffentlicht das Docker-Image in GitHub Packages.

Damit Updates sich über die installierte App installieren lassen, muss jede APK mit **demselben Schlüssel** signiert sein. Dafür im Repository unter *Settings → Secrets and variables → Actions* vier Secrets anlegen:

| Secret | Inhalt |
|---|---|
| `XENIOS_KEYSTORE_BASE64` | Keystore als Base64 |
| `XENIOS_KEYSTORE_PASSWORD` | Keystore-Passwort |
| `XENIOS_KEY_ALIAS` | `xenia` |
| `XENIOS_KEY_PASSWORD` | Schlüssel-Passwort |

Den Keystore in `app/keystore/` ablegen (wird nie eingecheckt, siehe `.gitignore`). Liegen dort die vier Werte als Dateien, setzt die GitHub-CLI sie so:
```bash
cd app/keystore
for s in XENIOS_KEYSTORE_BASE64 XENIOS_KEYSTORE_PASSWORD XENIOS_KEY_ALIAS XENIOS_KEY_PASSWORD; do gh secret set "$s" < "$s.txt"; done
```
**Den Ordner `app/keystore/` sicher aufbewahren.** Ohne den Schlüssel lassen sich keine Updates mehr über die vorhandene App installieren, nur neu installieren.

Ohne Secrets baut der Workflow trotzdem, signiert aber mit einem wechselnden Debug-Schlüssel.

### Lokal (Android Studio)
Ordner `app/` in Android Studio öffnen und *Run* drücken. Für eine Release-APK die Umgebungsvariablen `XENIOS_KEYSTORE`, `XENIOS_KEYSTORE_PASSWORD`, `XENIOS_KEY_ALIAS` und `XENIOS_KEY_PASSWORD` setzen und `gradle assembleRelease` ausführen.

## Installieren
1. APK auf das Handy laden (Artefakt-ZIP entpacken bzw. aus dem Release).
2. Öffnen und „Aus unbekannten Quellen installieren“ für den Browser bzw. Dateimanager erlauben. Neuere Android-Versionen geben das erst in den Entwickleroptionen frei, oft mit einem Fenster von 24 Stunden. Der Weg unterscheidet sich je nach Handy.
3. App starten und eine der beiden Arten wählen.
   - **Mit Server:** Adresse und App-Passwort. Die Oberfläche kommt vom Server. Nach einem Server-Update reicht die vorhandene App, siehe [Linux, Aktualisieren](Installation-Linux-Docker.md#8-aktualisieren-und-sichern).
   - **Direkt im Heimnetz:** **Neue Xenia** oder **Alte Xenia**, dazu die IP der Maschine und optional die Mühle. Diese Wahl und die Oberfläche dafür liegen in der APK. Ab Release 2.2.0 ist die alte Xenia im Direkt-Modus enthalten.
4. Widgets: Startbildschirm lange drücken → *Widgets* → *Xenios*. Kachel: Schnelleinstellungen bearbeiten → *Xenios* hineinziehen.

## Test mit der Simulation
```bash
cd server
npm run mock
npm run dev
```
Im Emulator als Server-Adresse `http://10.0.2.2:<Port aus config.dev.json>` eingeben.
