import jwt
import logging
from urllib.parse import urlparse
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.config import settings

logger = logging.getLogger("auth_middleware")

_jwks_client = None
SKIP_PATHS = {"/", "/health", "/api/whatsapp/webhook"}


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client
    parsed = urlparse(settings.supabase_url)
    jwks_url = f"{parsed.scheme}://{parsed.hostname}/auth/v1/.well-known/jwks.json"
    logger.info("Initializing JWKS client from %s", jwks_url)
    _jwks_client = jwt.PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


class JWTAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in SKIP_PATHS or request.method == "OPTIONS":
            request.state.auth_verified = False
            request.state.verified_user_id = None
            return await call_next(request)

        auth = request.headers.get("Authorization", "")

        if not auth.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"detail": "Missing authorization token"})

        token = auth[7:]
        try:
            header = jwt.get_unverified_header(token)
            jwks_client = _get_jwks_client()
            signing_key = jwks_client.get_signing_key_from_jwt(token)

            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[header.get("alg", "ES256")],
                audience="authenticated",
                options={"require": ["sub", "exp"]},
                leeway=60,
            )
            request.state.verified_user_id = payload.get("sub")
            request.state.auth_verified = True
        except jwt.ExpiredSignatureError:
            return JSONResponse(status_code=401, content={"detail": "Token expired"})
        except jwt.PyJWKClientError as e:
            logger.warning("JWKS fetch failed: %s", e)
            return JSONResponse(status_code=401, content={"detail": "Auth service unavailable"})
        except jwt.InvalidTokenError as e:
            logger.warning("JWT verification failed: %s", e)
            return JSONResponse(status_code=401, content={"detail": "Invalid token"})

        response = await call_next(request)
        return response
