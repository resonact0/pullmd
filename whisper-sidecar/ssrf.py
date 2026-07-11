"""Minimal SSRF guard for outbound URLs this sidecar fetches itself (yt-dlp).

The main Node app validates every URL it fetches through lib/ssrf.js before
the request leaves the process. This sidecar's /media endpoint hands a
caller-supplied URL straight to yt-dlp, which makes its own outbound
requests that never pass through the Node layer's guard — so the same class
of check has to be re-applied here, independently.

This is a best-effort, resolve-then-check guard (same limitation as the Node
version): a DNS answer could still change between this check and yt-dlp's
own connection (TOCTOU / DNS rebinding). It blocks the common cases (cloud
metadata endpoints, RFC 1918 ranges, loopback) without trying to be a full
network policy engine.
"""
import ipaddress
import socket
from urllib.parse import urlparse


class SsrfError(Exception):
    pass


def _is_blocked_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparseable -> treat as unsafe
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local
        or ip.is_reserved or ip.is_multicast or ip.is_unspecified
    )


def assert_url_allowed(raw_url):
    """Raise SsrfError if raw_url is not a safe http(s) URL to fetch."""
    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https"):
        raise SsrfError(f"scheme not allowed: {parsed.scheme or '(none)'}")
    host = parsed.hostname
    if not host:
        raise SsrfError("missing host")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise SsrfError(f"could not resolve host: {host}")
    if not infos:
        raise SsrfError(f"host did not resolve: {host}")

    for info in infos:
        ip_str = info[4][0]
        if _is_blocked_ip(ip_str):
            raise SsrfError(f"blocked address {ip_str} for host {host}")
