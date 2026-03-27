from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "분양 자동화 시스템"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql://apply_user:apply_pass@localhost:5432/apply_db"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Security
    SECRET_KEY: str = "change-this-secret-key-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8시간

    # File storage
    UPLOAD_DIR: str = "/tmp/apply_uploads"
    MAX_UPLOAD_SIZE_MB: int = 50

    # OCR
    TESSERACT_CMD: Optional[str] = None  # None = 자동 감지

    # Claude AI (서류 분석, 계약서 검수)
    ANTHROPIC_API_KEY: Optional[str] = None

    # Kakao (알림톡)
    KAKAO_API_KEY: Optional[str] = None

    # SMTP (이메일)
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None

    class Config:
        env_file = ".env"


settings = Settings()
