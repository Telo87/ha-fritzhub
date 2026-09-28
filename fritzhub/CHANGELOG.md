# Changelog

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
