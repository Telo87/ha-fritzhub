"""Unit tests for the parts that don't need a real FRITZ!Box."""

import struct

import pytest

from fritzhub.audio import to_playable_wav
from fritzhub.box import _xml_items, parse_mesh
from fritzhub.config import BoxStore
from fritzhub.discovery import _parse_desc
from fritzhub.nas import _parse_list_line, norm

MESH = {
    "nodes": [
        {
            "uid": "n1", "device_name": "FRITZ!Box 7590", "device_mac_address": "aa:aa:aa:aa:aa:01",
            "mesh_role": "master", "is_meshed": True, "device_model": "FRITZ!Box 7590",
            "node_interfaces": [
                {"uid": "i1", "name": "AP:5G:0", "type": "WLAN", "mac_address": "aa:aa:aa:aa:aa:02",
                 "node_links": [
                     {"uid": "l1", "state": "CONNECTED", "type": "WLAN", "node_1_uid": "n1",
                      "node_2_uid": "n2", "node_interface_1_uid": "i1", "node_interface_2_uid": "i2",
                      "cur_data_rate_rx": 866000, "cur_data_rate_tx": 780000},
                     {"uid": "l2", "state": "DISCONNECTED", "type": "WLAN", "node_1_uid": "n1",
                      "node_2_uid": "n3", "node_interface_1_uid": "i1", "node_interface_2_uid": "i3"},
                 ]},
            ],
        },
        {
            "uid": "n2", "device_name": "iPhone", "device_mac_address": "bb:bb:bb:bb:bb:01",
            "mesh_role": "unknown", "is_meshed": False,
            "node_interfaces": [
                {"uid": "i2", "name": "WLAN", "type": "WLAN", "mac_address": "bb:bb:bb:bb:bb:01",
                 "node_links": [
                     # the same link is listed on both ends – must be deduplicated
                     {"uid": "l1", "state": "CONNECTED", "type": "WLAN", "node_1_uid": "n1",
                      "node_2_uid": "n2", "node_interface_1_uid": "i1", "node_interface_2_uid": "i2"},
                 ]},
            ],
        },
    ]
}


def test_parse_mesh_builds_graph():
    graph = parse_mesh(MESH)
    assert [n["id"] for n in graph["nodes"]] == ["n1", "n2"]
    master = graph["nodes"][0]
    assert master["infrastructure"] and master["role"] == "master"
    assert "AA:AA:AA:AA:AA:02" in master["macs"]
    assert len(graph["links"]) == 1  # deduplicated, disconnected link dropped
    link = graph["links"][0]
    assert (link["source"], link["target"], link["band"]) == ("n1", "n2", "5 GHz")
    assert link["rate_rx"] == 866000


def test_xml_items():
    xml = "<Root><Call><Id>1</Id><Type>2</Type><Name/></Call><Call><Id>2</Id></Call></Root>"
    assert _xml_items(xml, "Call") == [{"Id": "1", "Type": "2", "Name": ""}, {"Id": "2"}]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("", "/"), ("/", "/"), ("//USB-Stick", "/USB-Stick"), ("a/b/../c", "/a/c"), ("/x/./y/", "/x/y")],
)
def test_nas_norm(raw, expected):
    assert norm(raw) == expected


def test_nas_list_line():
    entry = _parse_list_line("drwxr-xr-x   1 ftp ftp        0 Sep 28 12:00 Fotos")
    assert entry["name"] == "Fotos" and entry["dir"] and entry["size"] == 0
    assert entry["modified"].endswith("-09-28T12:00:00")
    entry = _parse_list_line("-rw-r--r--   1 ftp ftp     1234 Jan  3  2025 Datei mit Leerzeichen.pdf")
    assert entry["name"] == "Datei mit Leerzeichen.pdf" and entry["size"] == 1234
    assert entry["modified"] == "2025-01-03T00:00:00"
    # fewer columns (no link count / group) and names with spaces
    entry = _parse_list_line("drwxrwxrwx ftp 4096 Mar 10 08:15 Intenso USB")
    assert entry["name"] == "Intenso USB" and entry["dir"]
    assert _parse_list_line("total 3") is None
    assert _parse_list_line("drwxr-xr-x 1 ftp ftp 0 Sep 28 12:00 ..") is None


def test_nas_list_line_dos():
    entry = _parse_list_line("09-28-26  12:05PM       <DIR>          Fotos")
    assert entry == {"name": "Fotos", "dir": True, "size": None, "modified": "2026-09-28T12:05:00"}
    entry = _parse_list_line("01-03-25  08:00AM             1234 Rechnung.pdf")
    assert entry["size"] == 1234 and not entry["dir"]


class _FakeFtp:
    """Mimics the FRITZ!Box FTP server: no MLST in FEAT, LIST only."""

    def __init__(self):
        self.cwd_path = None
        self.commands = []

    def sendcmd(self, cmd):
        self.commands.append(cmd)
        return "211- Extensions supported:\n UTF8\n MDTM\n SIZE\n211 end"

    def mlsd(self, *args, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("MLSD must not be used")

    def cwd(self, path):
        self.cwd_path = path

    listing = b"drwxr-xr-x 1 ftp ftp 0 Sep 28 12:00 Intenso USB\r\n"
    encoding = "utf-8"

    def retrbinary(self, cmd, callback):
        self.commands.append(cmd)
        callback(self.listing)


def test_nas_uses_list_when_mlsd_unsupported():
    from fritzhub.config import BoxConfig
    from fritzhub.nas import FritzNas

    ftp = _FakeFtp()
    entries = FritzNas(BoxConfig(host="x"))._listdir(ftp, "/")
    assert [e["name"] for e in entries] == ["Intenso USB"]
    assert ftp.cwd_path == "/" and "LIST" in ftp.commands


def _wav(fmt_tag: int, bits: int, payload: bytes) -> bytes:
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(payload), b"WAVE", b"fmt ", 16, fmt_tag, 1,
        8000, 8000 * bits // 8, bits // 8, bits, b"data", len(payload),
    ) + payload


def test_ulaw_is_converted_to_pcm16():
    out, mime = to_playable_wav(_wav(7, 8, bytes([0xFF, 0x00, 0x80])))
    assert mime == "audio/wav"
    fmt_tag, channels, rate, _, _, bits = struct.unpack("<HHIIHH", out[20:36])
    assert (fmt_tag, channels, rate, bits) == (1, 1, 8000, 16)
    samples = struct.unpack("<3h", out[44:50])
    assert samples[0] == 0  # 0xFF is µ-law silence
    assert samples[1] < -30000 and samples[2] > 30000


def test_pcm_wav_passes_through():
    wav = _wav(1, 16, b"\x01\x00\x02\x00")
    assert to_playable_wav(wav) == (wav, "audio/wav")


def test_non_wav_passes_through():
    assert to_playable_wav(b"garbage")[1] == "application/octet-stream"


def test_parse_desc_only_accepts_avm():
    xml = (
        '<root xmlns="urn:dslforum-org:device-1-0"><systemVersion><Display>7.57</Display></systemVersion>'
        "<device><friendlyName>FRITZ!Box 7590</friendlyName><manufacturer>AVM</manufacturer>"
        "<modelName>FRITZ!Box 7590</modelName></device></root>"
    )
    assert _parse_desc(xml) == {
        "name": "FRITZ!Box 7590", "model": "FRITZ!Box 7590", "manufacturer": "AVM", "firmware": "7.57",
    }
    assert _parse_desc(xml.replace("AVM", "Other").replace("FRITZ!Box 7590", "Router")) is None


def test_parse_desc_new_vendor_name():
    # AVM was renamed to "FRITZ! GmbH"; firmware display is hw.major.minor-build
    xml = (
        '<root xmlns="urn:dslforum-org:device-1-0"><systemVersion><Display>272.08.40-136743</Display>'
        "</systemVersion><device><friendlyName>FritzBox-Buero</friendlyName>"
        "<manufacturer>FRITZ! GmbH</manufacturer><modelName>FRITZ!Box 5590 Fiber</modelName></device></root>"
    )
    result = _parse_desc(xml)
    assert result["model"] == "FRITZ!Box 5590 Fiber"
    assert result["firmware"] == "8.40"


def test_box_store_keeps_password_on_edit(tmp_path):
    store = BoxStore(tmp_path / "boxes.json")
    box = store.upsert({"host": "192.168.178.1", "username": "ha", "password": "secret"})
    store.upsert({"id": box.id, "host": "192.168.178.1", "name": "Box", "password": ""})
    reloaded = BoxStore(tmp_path / "boxes.json").get(box.id)
    assert reloaded.password == "secret" and reloaded.name == "Box"
    assert "password" not in reloaded.public() and reloaded.public()["has_password"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("272.08.40", "8.40"), ("154.08.40-136743", "8.40"), ("290.08.24", "8.24"), ("8.02", "8.02"), (None, None)],
)
def test_format_firmware(raw, expected):
    from fritzhub.box import format_firmware

    assert format_firmware(raw) == expected


@pytest.mark.parametrize(("raw", "expected"), [("70", 70), (35, 35), ("-60", 80), ("-100", 0), ("150", 100), (None, None)])
def test_signal_percent(raw, expected):
    from fritzhub.box import signal_percent

    assert signal_percent(raw) == expected


MANUF_SAMPLE = """# comment
3C:A6:2F\tAVMAudiovisu\tAVM Audiovisuelles Marketing und Computersysteme GmbH
00:17:88\tPhilipsLight\tPhilips Lighting BV
A4:CF:12\tEspressif\tEspressif Inc.
00:1B:C5:00:10:00/36\tOpenRBcomDir\tOpenRB.com, Direct SIA
00:1B:C5\tIEEERegistr\tIEEE Registration Authority
"""


def test_vendor_lookup(tmp_path):
    import gzip

    from fritzhub.oui import VendorDB

    path = tmp_path / "manuf.gz"
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        fh.write(MANUF_SAMPLE)
    db = VendorDB(path)
    assert db.lookup("3c:a6:2f:11:22:33")["vendor"] == "AVM"
    assert db.lookup("A4-CF-12-00-00-01")["vendor"] == "Espressif"
    assert db.lookup("00:17:88:01:02:03")["vendor"] == "Philips Lighting"
    # the more specific /36 block wins over the /24 registry block
    assert db.lookup("00:1B:C5:00:10:FF")["vendor"] == "OpenRB.com"
    assert db.lookup("00:1B:C5:FF:00:00")["vendor"] == "IEEE Registration Authority"
    # locally administered (randomized) address
    assert db.lookup("DA:A1:19:00:00:01") == {"vendor": None, "vendor_full": None, "private": True}
    assert db.lookup("12:34:56:78:9A:BC")["private"] is True
    assert db.lookup("00:00:00:00:00:01")["vendor"] is None
    assert db.lookup("invalid") is None


def test_vendor_db_missing_file(tmp_path):
    from fritzhub.oui import VendorDB

    assert VendorDB(tmp_path / "missing.gz").lookup("3C:A6:2F:11:22:33")["vendor"] is None


def test_stats_history_buckets(tmp_path):
    from fritzhub.stats import Stats

    st = Stats(tmp_path / "stats.json")
    now = 1_790_000_000 // 1800 * 1800  # start of a 30-min bucket
    for i in range(6):  # 6 samples within the same minute
        st.record_rate("box", now + i * 10, 1000, 100)
    st.record_rate("box", now + 60, 3000, 300)
    assert st.data["history"]["box"][0] == [now, 6000, 600, 6]
    # 24h view: 5-minute buckets, averaged per sample
    assert st.history("box", "24h", now=now + 120) == [[now, 1286, 129]]


def test_stats_volume_handles_counter_reset(tmp_path):
    from datetime import date

    from fritzhub.stats import Stats

    st = Stats(tmp_path / "stats.json")
    d1, d2 = date(2026, 8, 31), date(2026, 9, 1)
    st.record_volume("box", 1000, 100, today=d1)  # first sample: baseline only
    st.record_volume("box", 1500, 150, today=d1)
    st.record_volume("box", 300, 30, today=d2)  # reconnect: counters restart at 0
    st.record_volume("box", 800, 80, today=d2)
    v = st.volume("box", today=d2)
    assert v["prev_month"] == [500, 50]
    assert v["month"] == [800, 80] and v["today"] == [800, 80]
    assert v["since"] == "2026-08-31"
    assert [d[0] for d in v["days"]] == ["2026-08-31", "2026-09-01"]


def test_stats_last_seen_and_persistence(tmp_path):
    from fritzhub.stats import Stats

    path = tmp_path / "stats.json"
    st = Stats(path)
    st.mark_seen([{"mac": "AA", "active": True}, {"mac": "BB", "active": False}], now=100)
    st.mark_seen([{"mac": "AA", "active": True}], now=200)
    st.save()
    again = Stats(path)
    assert again.seen("AA") == {"first": 100, "last": 200}
    assert again.seen("BB") is None


def test_nas_latin1_listing_switches_encoding():
    from fritzhub.config import BoxConfig
    from fritzhub.nas import FritzNas

    ftp = _FakeFtp()
    ftp.listing = "-rw-r--r-- 1 ftp ftp 12 Sep 28 12:00 Rechnung März ´24.pdf\r\n".encode("latin-1")
    nas = FritzNas(BoxConfig(host="x"))
    entries = nas._listdir(ftp, "/")
    assert entries[0]["name"] == "Rechnung März ´24.pdf"
    assert ftp.encoding == "latin-1" and nas._encoding == "latin-1"
