from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.settings_db import get_all_settings, upsert_setting

router = APIRouter()


class SettingsUpdate(BaseModel):
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    openai_api_key: Optional[str] = None
    nvidia_api_key: Optional[str] = None
    nvidia_base_url: Optional[str] = None
    nvidia_model: Optional[str] = None


@router.get("/settings")
def list_settings():
    return get_all_settings()


@router.put("/settings")
def update_settings(data: SettingsUpdate):
    pairs = {
        "llm_provider": data.llm_provider,
        "llm_model": data.llm_model,
        "openai_api_key": data.openai_api_key,
        "nvidia_api_key": data.nvidia_api_key,
        "nvidia_base_url": data.nvidia_base_url,
        "nvidia_model": data.nvidia_model,
    }
    for k, v in pairs.items():
        if v is not None:
            upsert_setting(k, v)
    return get_all_settings()
