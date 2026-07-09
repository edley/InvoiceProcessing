from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.services.org_service import get_user_role


class OrgMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        org_id = request.headers.get("X-Org-Id")

        verified_user_id = getattr(request.state, "verified_user_id", None)
        user_id = verified_user_id or request.headers.get("X-User-Id")

        request.state.org_id = org_id
        request.state.user_id = user_id
        request.state.user_role = None
        request.state.auth_verified = verified_user_id is not None

        if org_id and user_id:
            request.state.user_role = get_user_role(org_id, user_id)

        response = await call_next(request)
        return response
