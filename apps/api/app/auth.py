"""better-auth JWT verification.

Every request to the API carries a short-lived JWT minted by the better-auth service
(apps/auth, JWT plugin: GET /api/auth/token). Verification is stateless against the
service's JWKS endpoint. The same token authenticates the PowerSync client (its `sub`
feeds sync-rule buckets), so user identity is consistent across the download and
upload paths.

better-auth signs with EdDSA (Ed25519) by default; RS256 is accepted too in case
`keyPairConfig` is ever switched.
"""

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

from app.config import get_settings

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(get_settings().auth_jwks_url)
    return _jwks_client


@dataclass(frozen=True)
class CurrentUser:
    id: str  # better-auth user id (JWT `sub`)


async def get_current_user(request: Request) -> CurrentUser:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.removeprefix("Bearer ")
    settings = get_settings()
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["EdDSA", "RS256"],
            issuer=settings.auth_issuer,
            audience=settings.auth_audience,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    return CurrentUser(id=claims["sub"])


CurrentUserDep = Depends(get_current_user)
