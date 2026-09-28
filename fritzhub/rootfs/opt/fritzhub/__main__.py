"""Entry point: ``python3 -m fritzhub``."""

import logging
import socket

from aiohttp import web

from .config import load_options
from .server import create_app


def main() -> None:
    options = load_options()
    logging.basicConfig(
        level=getattr(logging, options.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # fritzconnection/urllib3 are chatty on self-signed certificates
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    # fritzconnection logs every failed connection as ERROR; FritzHub reports
    # unreachable boxes itself (once, with a readable message)
    logging.getLogger("fritzconnection").setLevel(logging.CRITICAL)
    app = create_app(options)
    socks = [socket.create_server(("0.0.0.0", options.port))]
    if app["auth"]:
        try:
            socks.append(socket.create_server(("0.0.0.0", options.direct_port)))
            logging.getLogger("fritzhub").info(
                "Direktzugriff aktiv: http://<IP von Home Assistant>:%d (Benutzer „%s“)",
                options.direct_port, options.direct_username,
            )
        except OSError as err:
            app["auth"] = None
            logging.getLogger("fritzhub").error(
                "Direktzugriff: Port %d kann nicht geöffnet werden (%s) – bitte einen anderen wählen.",
                options.direct_port, err,
            )
    web.run_app(app, sock=socks, access_log=None, print=None)


if __name__ == "__main__":
    main()
