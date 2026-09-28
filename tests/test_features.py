"""Tests for new-device alarm, settings and call barring helpers."""

import asyncio

from fritzhub.config import Options, Settings
from fritzhub.hub import Hub
from fritzhub.stats import Stats


def test_update_known_baseline_and_new(tmp_path):
    st = Stats(tmp_path / "stats.json")
    hosts = [{"mac": "AA", "name": "a"}, {"mac": "BB", "name": "b"}]
    assert st.update_known(hosts, now=100) == []  # first run = inventory, no alarm
    assert st.known_since("AA") == 0
    new = st.update_known(hosts + [{"mac": "CC", "name": "c", "ip": "1.2.3.4"}], now=200)
    assert [h["mac"] for h in new] == ["CC"]
    assert st.known_since("CC") == 200
    assert st.new_devices[0]["name"] == "c"
    assert st.update_known(hosts + [{"mac": "CC"}], now=300) == []  # reported only once


def test_update_known_ignores_bursts(tmp_path):
    st = Stats(tmp_path / "stats.json")
    st.update_known([{"mac": "AA"}], now=1)
    burst = [{"mac": f"M{i}"} for i in range(25)]
    assert st.update_known(burst, now=2) == []  # e.g. another box delivers the host list
    assert st.known_since("M3") == 0


def test_settings_persist_and_types(tmp_path):
    path = tmp_path / "settings.json"
    s = Settings(path)
    assert s.get("new_device_alarm") is True
    s.update({"new_device_alarm": 0, "notify_service": "  notify.mobile_app_x ", "unknown": 1})
    again = Settings(path)
    assert again.get("new_device_alarm") is False
    assert again.get("notify_service") == "notify.mobile_app_x"
    assert "unknown" not in again.data


class _FakePublisher:
    available = True

    def __init__(self):
        self.calls = []

    async def fire_event(self, event, data):
        self.calls.append(("event", event, data))

    async def call_service(self, service, data):
        self.calls.append(("service", service, data))

    async def close(self):
        pass


def _hub(tmp_path, **settings):
    from fritzhub.config import BoxStore

    hub = Hub(Options(), store=BoxStore(tmp_path / "boxes.json"), stats=Stats(tmp_path / "stats.json"),
              settings=Settings(tmp_path / "settings.json"))
    hub.settings.update(settings)
    hub.publisher = _FakePublisher()
    return hub


def test_new_device_notifications(tmp_path):
    hub = _hub(tmp_path, notify_service="notify.mobile_app_phone")
    asyncio.run(hub._announce_new_devices([{"mac": "3C:A6:2F:00:00:01", "name": "Neues Handy", "ip": "192.168.0.50"}]))
    kinds = [(c[0], c[1]) for c in hub.publisher.calls]
    assert ("event", "fritzhub_new_device") in kinds
    assert ("service", "persistent_notification.create") in kinds
    assert ("service", "notify.mobile_app_phone") in kinds
    persistent = next(c[2] for c in hub.publisher.calls if c[1] == "persistent_notification.create")
    assert "Neues Handy" in persistent["message"] and "192.168.0.50" in persistent["message"]


def test_new_device_alarm_can_be_disabled(tmp_path):
    hub = _hub(tmp_path, new_device_alarm=False)
    asyncio.run(hub._announce_new_devices([{"mac": "AA:BB:CC:00:00:01", "name": "x"}]))
    assert hub.publisher.calls == []


def test_new_device_without_persistent_or_push(tmp_path):
    hub = _hub(tmp_path, notify_persistent=False, notify_service="")
    asyncio.run(hub._announce_new_devices([{"mac": "AA:BB:CC:00:00:01", "name": "x"}]))
    assert [c[1] for c in hub.publisher.calls] == ["fritzhub_new_device"]


def test_call_barring_entry_xml():
    from fritzhub.box import FritzBox
    from fritzhub.config import BoxConfig

    box = FritzBox(BoxConfig(host="x"))
    sent = {}

    def fake_call(service, action, **kwargs):
        sent.update(service=service, action=action, **kwargs)
        return {"NewPhonebookEntryUniqueID": "7"}

    box.call = fake_call
    assert box.call_barring_add("+49 (171) 123-4567", "Werbung & Co") == 7
    assert (sent["service"], sent["action"]) == ("X_AVM-DE_OnTel1", "SetCallBarringEntry")
    xml = sent["NewPhonebookEntryData"]
    assert xml.startswith('<?xml version="1.0" encoding="utf-8"?><contact>')
    assert "<realName>Werbung &amp; Co</realName>" in xml
    assert '<number type="home" prio="1" id="0">+491711234567</number>' in xml


def _uplink_box(responses):
    from fritzhub.box import FritzBox
    from fritzhub.config import BoxConfig

    box = FritzBox(BoxConfig(host="x"))
    box.wlan_services = lambda: sorted(responses)
    box.try_call = lambda svc, action, **kw: responses[int(svc.removeprefix("WLANConfiguration"))]
    return box


def test_wlan_uplink_picks_fastest_link_and_converts_kbit():
    box = _uplink_box({
        1: {"NewX_AVM-DE_SignalStrength": "80", "NewX_AVM-DE_Speed": "286", "NewX_AVM-DE_FrequencyBand": "2400",
            "NewX_AVM-DE_SpeedRX": "258000", "NewChannel": "6"},
        2: {"NewX_AVM-DE_SignalStrength": "61", "NewX_AVM-DE_Speed": "1201", "NewX_AVM-DE_FrequencyBand": "5000",
            "NewX_AVM-DE_SpeedRX": "960", "NewX_AVM-DE_SpeedMax": "2402", "NewX_AVM-DE_ChannelWidth": "80"},
        3: {},  # guest network: no uplink
    })
    up = box.wlan_uplink()
    assert (up["band"], up["signal"], up["speed_tx"], up["max_tx"], up["width"]) == ("5 GHz", 61, 1201, 2402, 80)
    assert len(up["links"]) == 2
    assert up["links"][1]["speed_rx"] == 258  # kbit/s -> Mbit/s


def test_wlan_uplink_none_for_lan_connected():
    box = _uplink_box({1: {"NewX_AVM-DE_SignalStrength": "0", "NewX_AVM-DE_Speed": "0"}, 2: {}})
    assert box.wlan_uplink() is None


def test_mesh_parents_follow_chain_towards_master():
    from fritzhub.hub import mesh_parents

    infra = lambda i, role: {"id": i, "role": role, "infrastructure": True}  # noqa: E731
    mesh = {
        "nodes": [infra("m", "master"), infra("a", "slave"), infra("b", "slave"),
                  {"id": "phone", "role": "unknown", "infrastructure": False}],
        "links": [
            {"source": "b", "target": "a", "type": "LAN", "rate_rx": 100000},
            {"source": "m", "target": "a", "type": "LAN", "rate_rx": 1000000},
            {"source": "b", "target": "phone", "type": "WLAN"},
        ],
    }
    parents = mesh_parents(mesh)
    assert parents["a"][0] == "m" and parents["a"][1]["rate_rx"] == 1000000
    assert parents["b"][0] == "a" and parents["b"][1]["rate_rx"] == 100000
    assert "phone" not in parents and "m" not in parents
