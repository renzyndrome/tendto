from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import ai, bootstrap, health, sync, workspaces

app = FastAPI(title="TendTo API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().web_url],  # WEB_URL env; Vite dev default
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(bootstrap.router)
app.include_router(sync.router)
app.include_router(workspaces.router)
app.include_router(ai.router)
