# Changelog

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
