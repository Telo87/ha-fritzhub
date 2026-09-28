# FritzHub – Dokumentation

## Erste Schritte

1. Add-on starten und **Web-UI öffnen**.
2. Auf **Netzwerk durchsuchen** klicken. FritzHub sucht per UPnP/SSDP und durch einen Scan des lokalen
   Subnetzes (Port 49000) nach FRITZ!Boxen, Repeatern und Powerline-Adaptern.
3. Bei jedem gefundenen Gerät auf **Hinzufügen** klicken und die Zugangsdaten eintragen.
   Mit **Verbindung testen** wird die Anmeldung vor dem Speichern geprüft.

Geräte, die nicht gefunden werden, können über **Manuell hinzufügen** mit IP-Adresse oder Hostname
(z. B. `fritz.box`) ergänzt werden.

## Vorbereitung der FRITZ!Box

### TR-064 aktivieren

*Heimnetz › Netzwerk › Netzwerkeinstellungen › Heimnetzfreigaben › Zugriff für Anwendungen zulassen*

Ohne diese Option ist keine Kommunikation möglich. Bei FRITZ!Repeatern ist TR-064 in der Regel
immer aktiv.

### Benutzer anlegen

Es wird empfohlen, einen eigenen Benutzer (z. B. `homeassistant`) unter
*System › FRITZ!Box-Benutzer* anzulegen. Benötigte Rechte:

| Recht | Wofür |
|---|---|
| FRITZ!Box Einstellungen | Übersicht, Geräte, Topologie, WLAN, System |
| Sprachnachrichten, Faxnachrichten, FRITZ!App Fon und Anrufliste | Anrufe, Anrufbeantworter, Rufumleitungen |
| Zugang zu NAS-Inhalten | FRITZ!NAS |

Ist die FRITZ!Box nur mit einem Kennwort (ohne Benutzername) gesichert, das Feld *Benutzername*
leer lassen.

### FRITZ!NAS

Der Dateizugriff erfolgt per FTP (bevorzugt verschlüsselt mit FTPS). Dafür muss unter
*Heimnetz › Speicher (NAS)* der Speicher aktiv und unter *Heimnetzfreigabe* der **Zugriff über FTP**
erlaubt sein.

## Mesh mit mehreren Geräten

- Der **Mesh Master** (FRITZ!Box) liefert Mesh-Topologie und Geräteliste für das ganze Netz.
- **Repeater** zusätzlich hinzufügen, um ihr WLAN, ihre Laufzeit und Firmware anzuzeigen und zu steuern.
- Jedes Gerät hat eigene Zugangsdaten. Im Mesh nutzen Repeater meist das Kennwort der FRITZ!Box –
  im Formular dafür **„Übernehmen von …“** wählen.
- Arbeitet eine zweite FRITZ!Box als Mesh Repeater (IP-Client), wird sie wie ein Repeater behandelt.

## Optionen

| Option | Standard | Beschreibung |
|---|---|---|
| `scan_interval` | `10` | Abfrageintervall in Sekunden (5–300) |
| `publish_sensors` | `true` | Wichtige Werte als Entitäten in Home Assistant bereitstellen |
| `verify_ssl` | `false` | TLS-Zertifikate der Box prüfen (FRITZ!Boxen nutzen selbstsignierte Zertifikate) |
| `log_level` | `info` | Protokollierungsstufe |

## Home-Assistant-Entitäten

Mit `publish_sensors: true` werden folgende Entitäten laufend aktualisiert
(`<box>` = Anzeigename bzw. Adresse der Box):

| Entität | Inhalt |
|---|---|
| `binary_sensor.fritzhub_<box>_online` | Box erreichbar (Attribute: Modell, Firmware, Update verfügbar) |
| `binary_sensor.fritzhub_<box>_internet` | Internetverbindung (Attribute: externe IPv4/IPv6) |
| `sensor.fritzhub_<box>_download` / `_upload` | Aktueller Durchsatz in Mbit/s |
| `sensor.fritzhub_<box>_external_ip` | Öffentliche IPv4-Adresse |
| `sensor.fritzhub_<box>_missed_calls` | Verpasste Anrufe der letzten 24 Stunden |
| `sensor.fritzhub_<box>_voicemail` | Neue Nachrichten auf dem Anrufbeantworter |
| `sensor.fritzhub_devices_online` | Anzahl aktiver Geräte im Heimnetz |

Diese Entitäten werden über die Home-Assistant-API gesetzt und haben keine eindeutige ID – sie lassen
sich daher nicht in der Oberfläche umbenennen, funktionieren aber in Dashboards und Automationen.
Nach einem Neustart von Home Assistant erscheinen sie wieder, sobald FritzHub das nächste Mal abfragt.

## Sicherheit

- Zugangsdaten liegen nur in `/data/boxes.json` im Add-on-Container (Dateirechte `600`) und werden
  nie an den Browser übertragen.
- Das Add-on läuft im Host-Netzwerk (für die automatische Suche per Multicast), akzeptiert
  Verbindungen aber ausschließlich vom Home-Assistant-Ingress-Proxy.

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Keine Geräte bei der Suche gefunden | TR-064 aktivieren; Box manuell mit IP hinzufügen |
| „Anmeldung fehlgeschlagen“ | Benutzername/Kennwort prüfen; Benutzer braucht das Recht *FRITZ!Box Einstellungen* |
| Anrufliste/Anrufbeantworter fehlen | Recht *Sprachnachrichten … und Anrufliste* vergeben |
| Mesh-Topologie leer | Nur der Mesh Master liefert die Topologie – FRITZ!Box hinzufügen |
| FRITZ!NAS nicht erreichbar | FTP-Zugriff aktivieren; Recht *Zugang zu NAS-Inhalten* vergeben |
| Internet sperren nicht verfügbar | Funktion benötigt ein aktuelles FRITZ!OS und eine IPv4-Adresse des Geräts |
