"""Serve the WeaveTogether practice on this machine and to other devices on the same network.

    python3 serve.py                # http on port 8095, prints the URLs to open here and from other devices
    python3 serve.py --open         # the same, and opens the page in the default browser
    python3 serve.py --port 9000    # another port (a busy port moves on to the next free one unless --port is given)
    python3 serve.py --verbose      # log every request, including the per-module and per-model chatter

Plain http is enough: the page uses WebGL (no WebGPU), which every browser allows over http. The server sends
Cache-Control: no-store, so an edited module or a re-exported lattice is always refetched. macOS may ask once to allow
incoming connections for Python — allow it, or other devices cannot connect.
"""
from __future__ import annotations

import argparse
import errno
import http.server
import os
import socket
import sys
import threading
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
APP = 'WeaveTogether'
PORT = 8095
VERBOSE = False


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
                      '.obj': 'text/plain; charset=utf-8', '.csv': 'text/csv', '.wasm': 'application/wasm', '.lshc': 'application/octet-stream'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):                              # quieter log: skip the per-module chatter
        line = fmt % args
        if not VERBOSE and ('"GET /js/' in line or '"GET /vendor/' in line or '"GET /models/' in line or 'favicon' in line):
            return
        super().log_message(fmt, *args)


# a browser drops connections all the time (preconnects, reloads, a tab closed mid-download): nothing is wrong, stay quiet
QUIET_ERRNO = {errno.EBADF, errno.ECONNRESET, errno.EPIPE, errno.ECONNABORTED, errno.ETIMEDOUT, errno.ENOTCONN, errno.ESHUTDOWN}


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        e = sys.exc_info()[1]
        if isinstance(e, (ConnectionError, TimeoutError)) or (isinstance(e, OSError) and e.errno in QUIET_ERRNO):
            if VERBOSE:
                print(f'{client_address[0]} - connection dropped: {type(e).__name__} {e}')
            return
        super().handle_error(request, client_address)


def bind(port, explicit):
    """the server on port, or on the next free port when the default one is taken"""
    for p in range(port, port + (1 if explicit else 20)):
        try:
            return Server(('0.0.0.0', p), Handler), p
        except OSError as e:
            if e.errno != errno.EADDRINUSE:
                raise
            print(f'port {p} is in use (another server still running?)' + ('' if explicit else ', trying the next one'))
    sys.exit('no free port: stop the other server (Ctrl-C in its terminal) or pass --port')


def lan_addresses():
    addrs = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.'):
                addrs.add(ip)
    except socket.gaierror:
        pass
    try:                                                            # the interface that routes outward
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); addrs.add(s.getsockname()[0]); s.close()
    except OSError:
        pass
    return sorted(addrs)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--port', type=int, default=None, help=f'default {PORT}')
    ap.add_argument('--open', action='store_true', help='open the page in the default browser')
    ap.add_argument('--verbose', action='store_true', help='log every request and dropped connection')
    args = ap.parse_args()
    global VERBOSE
    VERBOSE = args.verbose
    os.chdir(HERE)
    httpd, port = bind(args.port or PORT, explicit=args.port is not None)
    url = f'http://localhost:{port}/'
    print(f'{APP} — serving {HERE}')
    print(f'  this machine:   {url}   (index.html#cylinder, #Bunny, #cone5 … open on a case)')
    for ip in lan_addresses():
        print(f'  other devices:  http://{ip}:{port}/   (same Wi-Fi)')
    print('Ctrl-C stops the server.')
    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')


if __name__ == '__main__':
    sys.exit(main())
