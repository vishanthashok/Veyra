"""One error envelope for every failure:

    {"error": {"code": "...", "message": "...", "details": ..., "request_id": "..."}}

Internal errors never leak exception text to the client. They are logged with the request ID.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("veyra.errors")

CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
}


def _envelope(request: Request, status: int, message: str, details=None, headers=None):
    rid = getattr(request.state, "request_id", None)
    body = {
        "error": {
            "code": CODES.get(status, "internal_error" if status >= 500 else "error"),
            "message": message,
            "details": details,
            "request_id": rid,
        }
    }
    return JSONResponse(body, status_code=status, headers=headers)


def install(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        msg = exc.detail if isinstance(exc.detail, str) else "Request failed"
        details = None if isinstance(exc.detail, str) else exc.detail
        return _envelope(request, exc.status_code, msg, details, getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        first = details[0] if details else {"field": "", "message": "Invalid input"}
        msg = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
        return _envelope(request, 422, msg, details)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error", extra={"request_id": getattr(request.state, "request_id", None)})
        return _envelope(request, 500, "Something went wrong. Quote the request ID if you report it.")
