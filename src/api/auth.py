"""
Модуль аутентификации - JWT токены, регистрация, авторизация
"""
import os
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel, EmailStr
import jwt

# Секретный ключ для JWT (в продакшене использовать из переменных окружения)
SECRET_KEY = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # 7 дней


class UserCreate(BaseModel):
    """Модель для регистрации"""
    email: EmailStr
    password: str
    name: str


class UserLogin(BaseModel):
    """Модель для входа"""
    email: EmailStr
    password: str


class User(BaseModel):
    """Модель пользователя"""
    id: str
    email: str
    name: str
    created_at: str
    

class Token(BaseModel):
    """Модель токена"""
    access_token: str
    token_type: str = "bearer"
    user: User


def hash_password(password: str) -> str:
    """Хеширование пароля"""
    salt = "search_service_salt"
    return hashlib.sha256(f"{password}{salt}".encode()).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    """Проверка пароля"""
    return hash_password(password) == hashed


def create_access_token(user_id: str, email: str) -> str:
    """Создание JWT токена"""
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": user_id,
        "email": email,
        "exp": expire,
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Декодирование JWT токена"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def generate_api_key() -> str:
    """Генерация API ключа для проекта"""
    return f"sk_{secrets.token_hex(24)}"


def generate_user_id() -> str:
    """Генерация ID пользователя"""
    return f"user_{secrets.token_hex(8)}"


def generate_project_id() -> str:
    """Генерация ID проекта"""
    return f"proj_{secrets.token_hex(8)}"
