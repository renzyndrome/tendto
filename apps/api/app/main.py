from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import ai, bootstrap, health, members, presence, sync, workspaces
from app.startup_checks import assert_single_worker


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fails the boot, not a request: a configuration that quietly multiplies the AI spend limit
    # must be caught before anyone can reach the endpoint it protects. See startup_checks.
    assert_single_worker()
    yield


app = FastAPI(title="TendTo API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().web_url],  # WEB_URL env; Vite dev default
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(bootstrap.router)
app.include_router(workspaces.router)
app.include_router(members.router)
app.include_router(sync.router)
app.include_router(ai.router)
app.include_router(presence.router)
