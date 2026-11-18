"""Serves docs/ like GitHub Pages would after the service worker steps in: with the two headers
that make the page cross-origin isolated, so the threaded core runs.  python3 test/serve.py 8765"""
import http.server, sys, functools, pathlib
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin'); self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
root = pathlib.Path(__file__).resolve().parent.parent / 'docs'
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8765), functools.partial(H, directory=str(root))).serve_forever()
