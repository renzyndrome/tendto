"""A user's own AI key: GET, PUT and DELETE /ai/settings (see app/ai/user_keys.py).

Personal, so every route acts on the token subject's own row and nothing else; there is no id in
the path to point at someone else's. The key goes in through PUT and never comes back out.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.user_keys import (
    CUSTOM,
    PRESETS,
    custom_allowed,
    decrypt_key,
    encrypt_key,
    is_http_url,
    is_key_shaped,
    key_hint,
    keys_enabled,
    load_settings,
)
from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.models.core import UserAiSettings
from app.schemas.ai import AiKeySettingsIn, AiKeySettingsOut, AiProviderOut

router = APIRouter(prefix="/ai/settings", tags=["ai"])


def _out(row: UserAiSettings | None) -> AiKeySettingsOut:
    providers = [
        AiProviderOut(key=key, label=preset.label, default_model=preset.default_model)
        for key, preset in PRESETS.items()
    ]
    if custom_allowed():
        providers.append(AiProviderOut(key=CUSTOM, label="Custom URL", default_model=""))
    base = AiKeySettingsOut(
        enabled=keys_enabled(),
        custom_allowed=custom_allowed(),
        providers=providers,
        configured=False,
    )
    if row is None:
        return base
    return base.model_copy(
        update={
            "configured": True,
            "provider": row.provider,
            "model": row.model,
            "base_url": row.base_url if row.provider == CUSTOM else None,
            "key_hint": row.key_hint,
            "key_readable": decrypt_key(row.api_key_encrypted) is not None,
        }
    )


@router.get("", response_model=AiKeySettingsOut)
async def read_settings(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiKeySettingsOut:
    return _out(await load_settings(session, user.id))


@router.put("", response_model=AiKeySettingsOut)
async def save_settings(
    body: AiKeySettingsIn,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiKeySettingsOut:
    if not keys_enabled():
        raise HTTPException(status_code=503, detail="Own API keys disabled on this server.")

    provider = body.provider.strip()
    if provider == CUSTOM:
        if not custom_allowed():
            raise HTTPException(status_code=422, detail="Custom URL not allowed on this server.")
        base_url = (body.base_url or "").strip().rstrip("/")
        if not is_http_url(base_url):
            raise HTTPException(
                status_code=422, detail="Base URL must be http or https, with no credentials."
            )
        default_model = ""
    elif provider in PRESETS:
        base_url = ""
        default_model = PRESETS[provider].default_model
    else:
        raise HTTPException(status_code=422, detail="Unknown provider.")

    model = body.model.strip() or default_model
    if not model:
        raise HTTPException(status_code=422, detail="Model required.")

    existing = await load_settings(session, user.id)
    api_key = (body.api_key or "").strip()
    if api_key and not is_key_shaped(api_key):
        raise HTTPException(
            status_code=422, detail="API key invalid. No spaces or line breaks, 8+ characters."
        )
    if api_key:
        encrypted, hint = encrypt_key(api_key), key_hint(api_key)
    elif (
        existing is not None
        and existing.provider == provider
        and decrypt_key(existing.api_key_encrypted) is not None
    ):
        # Keep the stored key: a model change should not need the key typed again. Only for the
        # same provider: one provider's key sent to another would only ever be rejected.
        encrypted, hint = existing.api_key_encrypted, existing.key_hint
    else:
        raise HTTPException(status_code=422, detail="API key required.")

    values = {
        "provider": provider,
        "base_url": base_url,
        "model": model,
        "api_key_encrypted": encrypted,
        "key_hint": hint,
    }
    stmt = pg_insert(UserAiSettings).values(user_id=user.id, **values)
    # An upsert, so two saves at once cannot collide on the primary key. `updated_at` is set
    # by hand: ON CONFLICT DO UPDATE does not run the column's ORM `onupdate`.
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[UserAiSettings.user_id],
            set_={**values, "updated_at": func.now()},
        )
    )
    await session.commit()
    return _out(await load_settings(session, user.id))


@router.delete("", status_code=204)
async def remove_settings(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Forget the user's key. Their requests go back to the operator's engine."""
    await session.execute(delete(UserAiSettings).where(UserAiSettings.user_id == user.id))
    await session.commit()
    return Response(status_code=204)
