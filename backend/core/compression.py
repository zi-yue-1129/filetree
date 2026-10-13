"""Gzip JSON API responses while leaving file and upload traffic byte-identical."""

from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send


class ApiGZipMiddleware:
    """Restrict gzip to API payload routes, excluding binary transfer endpoints."""

    def __init__(self, app: ASGIApp) -> None:
        """Configure fast compression for API responses of at least one KiB.

        Args:
            app: Wrapped application.
        """
        self.app = app
        self.compressed_app = GZipMiddleware(app, minimum_size=1024, compresslevel=1)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Dispatch transfer traffic unchanged and compress eligible API payloads.

        Args:
            scope: ASGI request metadata.
            receive: Request message receiver.
            send: Response message sender.
        """
        path = scope.get("path", "")
        excluded = any(fragment in path for fragment in ("/download", "/batch-download", "/upload", "/thumbnail/"))
        if scope["type"] == "http" and path.startswith("/api/") and not excluded:
            await self.compressed_app(scope, receive, send)
        else:
            await self.app(scope, receive, send)
