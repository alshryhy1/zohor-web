#!/usr/bin/env python3
"""Serve the Mac camera as JPEG for the iOS Simulator live preview."""

from __future__ import annotations

import os
import signal
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8768
FRAME = "/tmp/zohor-sim-cam.jpg"


def start_ffmpeg() -> subprocess.Popen:
    try:
        os.remove(FRAME)
    except OSError:
        pass
    return subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "avfoundation",
            "-framerate",
            "30",
            "-video_size",
            "1280x720",
            "-i",
            "0",
            "-an",
            "-q:v",
            "5",
            "-f",
            "image2",
            "-update",
            "1",
            FRAME,
        ],
        stdout=subprocess.DEVNULL,
        stderr=open("/tmp/zohor-sim-cam.log", "ab"),
    )


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        path = (self.path or "/").split("?", 1)[0]
        if path not in ("/", "/frame.jpg"):
            self.send_error(404)
            return
        try:
            with open(FRAME, "rb") as handle:
                data = handle.read()
        except OSError:
            self.send_error(503)
            return
        if len(data) < 32:
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    ffmpeg = start_ffmpeg()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)

    def stop(_signum=None, _frame=None) -> None:
        server.shutdown()
        ffmpeg.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    time.sleep(0.4)
    try:
        server.serve_forever()
    finally:
        if ffmpeg.poll() is None:
            ffmpeg.terminate()


if __name__ == "__main__":
    main()
