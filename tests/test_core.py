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
    assert entry == {"name": "Fotos", "dir": True, "size": 0, "modified": None}
    entry = _parse_list_line("-rw-r--r--   1 ftp ftp     1234 Jan  3  2025 Datei mit Leerzeichen.pdf")
    assert entry["name"] == "Datei mit Leerzeichen.pdf" and entry["size"] == 1234
    assert _parse_list_line("total 3") is None


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
