"""Entry point: ``python3 -m fritzhub``."""

import logging

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
    web.run_app(app, host="0.0.0.0", port=options.port, access_log=None, print=None)


if __name__ == "__main__":
    main()
