"""
Django settings for ChatProject project.
"""

import os
from pathlib import Path

import dj_database_url


BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(key: str, default: bool = False) -> bool:
    return os.getenv(key, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(key: str, default: list[str]) -> list[str]:
    value = os.getenv(key)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "django-insecure-change-this-before-running-in-production",
)

DEBUG = env_bool("DEBUG", default=False)
IS_RENDER = env_bool("RENDER", default=False)

default_allowed_hosts = [
    "127.0.0.1",
    "localhost",
    "0.0.0.0",
    ".ngrok-free.app",
    ".ngrok-free.dev",
]
render_hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()
if render_hostname:
    default_allowed_hosts.append(render_hostname)

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", default_allowed_hosts)

default_csrf_trusted_origins = [
    "https://*.onrender.com",
    "https://*.ngrok-free.app",
    "https://*.ngrok-free.dev",
]
render_external_url = os.getenv("RENDER_EXTERNAL_URL", "").strip()
if render_external_url:
    default_csrf_trusted_origins.append(render_external_url)

CSRF_TRUSTED_ORIGINS = env_list(
    "CSRF_TRUSTED_ORIGINS",
    default_csrf_trusted_origins,
)


INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "chat",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "ChatProject.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "ChatProject.wsgi.application"
ASGI_APPLICATION = "ChatProject.asgi.application"


DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=600,
            ssl_require=not DEBUG,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True


STATIC_URL = "/static/"
STATICFILES_DIRS = []
STATIC_ROOT = os.path.join(BASE_DIR, "staticfiles_build")
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DIR, "media")


DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


redis_host = os.getenv("REDIS_HOST", "127.0.0.1")
redis_port = int(os.getenv("REDIS_PORT", "6379"))
redis_db = os.getenv("REDIS_DB", "0")
redis_cache_db = os.getenv("REDIS_CACHE_DB", "1")
redis_password = os.getenv("REDIS_PASSWORD", "")
redis_scheme = os.getenv("REDIS_SCHEME", "redis")

if redis_password:
    redis_base = f"{redis_scheme}://:{redis_password}@{redis_host}:{redis_port}"
else:
    redis_base = f"{redis_scheme}://{redis_host}:{redis_port}"

default_channel_layer = {
    "BACKEND": "channels.layers.InMemoryChannelLayer",
}
default_cache = {
    "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    "LOCATION": "quick-talk-local-cache",
}

if os.getenv("REDIS_URL") or IS_RENDER or env_bool("USE_REDIS", default=False):
    channel_hosts = [os.getenv("REDIS_URL", f"{redis_base}/{redis_db}")]
    cache_location = os.getenv("REDIS_CACHE_URL", f"{redis_base}/{redis_cache_db}")

    default_channel_layer = {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": channel_hosts,
        },
    }
    default_cache = {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": cache_location,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "IGNORE_EXCEPTIONS": True,
        },
    }

CHANNEL_LAYERS = {
    "default": default_channel_layer,
}

CACHES = {
    "default": default_cache,
}


SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", default=IS_RENDER and not DEBUG)
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", default=IS_RENDER and not DEBUG)
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", default=IS_RENDER and not DEBUG)


TURN_CREDENTIALS_URL = os.getenv("TURN_CREDENTIALS_URL", "")
