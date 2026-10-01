# Changelog

## 1.11.0

- Neu: **Online-Zeit auswerten** – in den Geräte-Details für einen frei wählbaren Zeitraum (7 Tage, 30 Tage, dieser/letzter Monat oder beliebige Daten): Online-Zeit gesamt, Verfügbarkeit, Ø pro Tag, Online-Phasen, Diagramm mit Online-Stunden je Tag, Tagestabelle und CSV-Export
- Online/Offline-Wechsel werden 400 Tage gespeichert (bisher 14)
- Zeiten, in denen FritzHub bzw. Home Assistant nicht lief, werden erkannt und zählen nicht als offline

## 1.10.0

- Neu: **Direktzugriff** (optional) – FritzHub zusätzlich über einen eigenen Port (Standard 8765) mit Benutzername und Passwort erreichbar, z. B. als **Webseiten-Karte im Dashboard** ohne das Home-Assistant-Menü oder auf einem Wand-Tablet; „Angemeldet bleiben“ (1 Jahr, verlängert sich), funktioniert auch eingebettet, Sperre nach 5 Fehlversuchen, Passwortänderung meldet alle Geräte ab
- Neu: **Darstellung** in den Einstellungen – Hell/Dunkel/Automatisch und sechs Akzentfarben
- Neu: Links „Auf GitHub bewerten“ und „Feedback & Fehler melden“ in der Seitenleiste
- Design: sanfte Seitenübergänge, gestaffelt einblendende Karten und Listen, zählende Zahlen, einwachsende Balken, sich zeichnendes Diagramm mit Live-Anzeige, weiches Zoomen und fließende WLAN-Verbindungen in der Topologie, animierte Dialoge und Meldungen
- Aktualisierung ohne Flackern: nur geänderte Werte werden ersetzt, Hover, Tooltips und Scroll-Position bleiben erhalten; Geräte, die online/offline gehen, leuchten kurz auf
- Alle Animationen werden bei „Bewegung reduzieren“ abgeschaltet

## 1.9.0

- Neu: **Geräte-Details** – Klick auf ein Gerät zeigt Status, Verfügbarkeit der letzten 7 Tage, Signalverlauf (3 Tage) und alle Ereignisse: Online/Offline, **Roaming zwischen Box und Repeatern**, Bandwechsel; Hinweis bei häufigem Hin- und Herspringen
- Neu: **Beobachtete Geräte** – Glocken-Symbol in der Geräteliste; Meldung, wenn ein Gerät länger als 3 Minuten offline ist und wenn es wieder da ist (Home Assistant, Push, Ereignisse `fritzhub_device_offline` / `fritzhub_device_online`), abschaltbar
- Neu: **Netzwerk-Check** – Empfehlungen aus allen Messwerten: Kanalkonflikte, Anbindung der Repeater, Auslastung der Zugangspunkte, dauerhaft schwache Geräte, springende Geräte, Geräte im 2,4-GHz-Netz, die 5 GHz können, alte Einträge, Updates
- Geräte-Protokoll wird dauerhaft gespeichert (`/data/devices.json`, Ereignisse 14 Tage, Signal 3 Tage)

## 1.8.2

- Weboberflächen: HTTP- und HTTPS-Variante desselben Servers (80/443, 8080/8443, 5000/5001) werden auch ohne Seitentitel nur einmal angezeigt
- Buttons zur Weboberfläche zeigen zusätzlich die Adresse

## 1.8.1

- Anbindung per LAN zeigt die tatsächliche Geschwindigkeit („LAN · 1 Gbit/s“) und warnt, wenn ein Repeater bzw. eine Mesh-Box mit weniger als 1 Gbit/s verbunden ist – mit Hinweis auf typische Ursachen (Kabel, Switch, Green Mode); in Übersicht, System und Topologie

## 1.8.0

- Neu: **WLAN-Anbindung der Repeater** – Signalstärke, aktuelle und maximale Sende-/Empfangsrate, Band, Kanal, Kanalbreite, Standard und Multi-Link (Wi-Fi 7) für jeden per WLAN angebundenen Repeater bzw. Mesh-Client
- Mesh-Topologie: Verbindungslinie zum Repeater nach Anbindungsqualität eingefärbt; Detailfenster mit Verlauf der letzten Stunde und Hinweis bei schwacher Anbindung
- Übersicht und System: Anbindung („5 GHz · 58 % · 638 Mbit/s“ bzw. „LAN“) bei jedem Repeater

## 1.7.3

- Wake on LAN entfernt

## 1.7.2

- „Boxen & Zugänge“ ist jetzt ein Reiter unter „Einstellungen“ (neben „Benachrichtigungen“); alte Links führen automatisch dorthin

## 1.7.1

- Geräteliste: Aktionen (Umbenennen, Wake on LAN) bleiben am rechten Rand sichtbar, auch wenn die Tabelle breiter als der Bildschirm ist; Spalte „Rate“ wird schon unter 1400 px ausgeblendet

## 1.7.0

- Neu: **Weboberflächen erkennen** – FritzHub prüft alle Geräte auf eine lokale Weboberfläche (Ports 80, 443, 8080, 8443, 5000, 5001, 8123, 8000, 8081, 8888; nur echte HTML-Seiten bzw. Anmeldeseiten zählen). Geräte bekommen ein „Web“-Kennzeichen, das die Oberfläche mit einem Klick in einem neuen Fenster öffnet; Filter „Weboberfläche“, Button „Weboberflächen suchen“, Links auch in der Mesh-Topologie. Geprüft wird beim Start, alle 30 Minuten und sofort bei neuen Geräten.

## 1.6.0

- Neu: **Alarm bei neuen Geräten** – Meldung in Home Assistant, optional Push aufs Handy (`notify.…`) und Ereignis `fritzhub_new_device` für Automationen; auf der neuen Seite „Einstellungen“ ein-/ausschaltbar, mit Liste der zuletzt erkannten Geräte; „Neu“-Kennzeichen und Filter in der Geräteliste
- Neu: **WLAN-Kanalprüfung** – zeigt die belegten 2,4-GHz-Kanäle aller Boxen/Repeater, warnt bei gemeinsamen oder überlappenden Kanälen und schlägt eine Verteilung auf 1 / 6 / 11 vor
- Neu: **Nummer sperren** direkt aus der Anrufliste (Rufsperre der FRITZ!Box), Liste „Gesperrte Nummern“ mit Entsperren und manuellem Hinzufügen
- Neu: **Geräte umbenennen** in der Geräteliste (Name wird in der FRITZ!Box gespeichert)

## 1.5.1

- FRITZ!NAS: Ordner mit Umlauten und Sonderzeichen im Namen führten zu einem Fehler – UTF-8 wird jetzt aktiviert, sonst wird automatisch auf Latin-1 umgestellt
- Protokoll: doppelte Fehlermeldungen der Bibliothek bei nicht erreichbaren Boxen (z. B. während eines Neustarts) entfernt

## 1.5.0

- Neu: Vorschau im FRITZ!NAS für Bilder, PDFs, Videos, Audio und Textdateien – mit Blättern per Pfeiltasten durch alle Dateien eines Ordners

## 1.4.0

- Neu: Datendurchsatz-Verlauf für 1 Stunde, 24 Stunden und 7 Tage (dauerhaft gespeichert)
- Neu: Karte „Datenvolumen“ mit heute, aktuellem und letztem Monat sowie Tagesbalken der letzten 31 Tage
- Neu: Spalte „Zuletzt gesehen“ und Filter „Lange offline“ (über 30 Tage) in der Geräteliste
- Neu: Neustart mit Live-Statusanzeige pro Gerät (Befehl gesendet → startet neu → wieder online), auch für „Alle neu starten“
- Diagramm-Achsen mit runden Werten

## 1.3.0

- Neu: „Alle neu starten“ auf der Seite System – startet alle erreichbaren Geräte nacheinander neu, Repeater zuerst und den Mesh Master zuletzt
- Mesh-Topologie: Endgeräte innerhalb jeder Gruppe und Repeater alphabetisch sortiert

## 1.2.0

- Neu: Hersteller-Erkennung anhand der MAC-Adresse (Spalte „Hersteller“ in der Geräteliste, durchsuchbar); zufällige/private MAC-Adressen werden als solche gekennzeichnet
- Mesh-Topologie übersichtlicher: kompakte Ansicht mit Geräte-Zusammenfassung je Box/Repeater; Klick zeigt die verbundenen Geräte nach Band gruppiert mit Signalstärke
- Volle Karte („Alle Endgeräte in der Karte“) nach Verbindungsart gruppiert und nach Signalqualität eingefärbt

## 1.1.0

- Neu: Signalstärke aller WLAN-Geräte – abgefragt bei der Box bzw. dem Repeater, mit dem das Gerät verbunden ist
- Übersicht: Karte „Schwächste WLAN-Verbindungen“ (Top 5)
- Geräte: Spalte „Signal“ (sortierbar) und Filter „Schwaches WLAN“ (unter 40 %)

## 1.0.6

- Automatische Aktualisierung springt nicht mehr an den Seitenanfang zurück

## 1.0.5

- FRITZ!NAS: Verzeichnisse werden per LIST gelesen, wenn der FTP-Server kein MLSD unterstützt (FRITZ!Box: „501 Feature MLST … not supported“)
- Ordner mit Leerzeichen im Namen (z. B. USB-Sticks) werden korrekt geöffnet
- Änderungsdatum der Dateien wird auch bei LIST angezeigt

## 1.0.4

- FRITZ!OS-Version ohne Hardware-Kennung anzeigen (z. B. „8.40“ statt „272.08.40“)

## 1.0.3

- Mesh-Rolle (Mesh Master / Mesh Repeater) wird aus der Mesh-Topologie ermittelt und überall angezeigt
- Mesh-Repeater zeigen den Hinweis, dass WLAN- und weitere Einstellungen vom Mesh Master übernommen werden; WLAN-Bearbeitung ist dort gesperrt
- FRITZ!Boxen im Mesh-Repeater-Betrieb werden zuverlässig nicht mehr als Internet-Router behandelt

## 1.0.2

- Mesh-Clients (FRITZ!Box als Repeater, FRITZ!Repeater) mit automatisch erzeugtem Benutzer (`fritz1234`) können ohne Benutzernamen angemeldet werden – der Benutzer wird automatisch ermittelt
- „Zugangsdaten übernehmen“ übernimmt nur das Kennwort, wenn der Benutzername auf dem Zielgerät nicht existiert
- Formular zeigt die auf dem Gerät vorhandenen Benutzer als Vorschläge an

## 1.0.1

- Automatische Suche erkennt Geräte mit neuem Herstellernamen „FRITZ! GmbH“ (FRITZ!OS 8.x)
- Firmware wird lesbar angezeigt (z. B. „8.40“ statt „272.08.40-…“)
- Standard-Gateway wird bei der Suche mitgeprüft
- FRITZ!Boxen im Mesh-Repeater-Betrieb werden nicht mehr als getrennte Router angezeigt
- Hinweistexte an neue Bezeichnung „Zugriff für Apps erlauben“ angepasst

## 1.0.0

- Erste Version
- Übersicht mit Internetstatus, Live-Durchsatz, DSL-Werten und Mesh-Geräten
- Interaktive Mesh-Topologie
- Geräteliste mit Internet-Sperre und Wake on LAN
- WLAN-Steuerung inkl. QR-Code
- Anrufliste und Rufumleitungen
- Anrufbeantworter abhören, herunterladen, markieren, löschen
- FRITZ!NAS-Dateibrowser (FTP/FTPS)
- Automatische Suche (SSDP + Subnetz-Scan), mehrere Zugangsdaten
- Home-Assistant-Sensoren
