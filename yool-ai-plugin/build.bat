@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  build.bat — Build Yool AI Plugin services
REM
REM  USAGE:
REM    .\build.bat              Build changed layers only (fast — uses cache)
REM    .\build.bat stt          Build only the stt service (uses cache)
REM    .\build.bat --fresh      Full rebuild, ignore cache (slow — for dep changes)
REM    .\build.bat stt --fresh  Fresh rebuild of one service only
REM
REM  HOW CACHING WORKS:
REM    Docker rebuilds only the layers that changed.
REM    - Changing app code  → only the last layer rebuilds  (~10 sec)
REM    - Changing requirements.txt → pip layer + app layer rebuild (~3-5 min)
REM    - Changing FROM base image → everything rebuilds (use --fresh)
REM
REM  WHY SEQUENTIAL?
REM    The STT image installs PyTorch (~270MB) + pyannote (~600MB).
REM    Building all images in parallel peaks at 5+ GB RAM and crashes Docker.
REM ─────────────────────────────────────────────────────────────────────────────

setlocal

REM ── Parse arguments ──────────────────────────────────────────────────────────
set TARGET=
set NOCACHE=

:parse_args
IF "%1"=="" goto :done_parsing
IF /I "%1"=="--fresh" ( set NOCACHE=--no-cache & shift & goto :parse_args )
IF NOT "%TARGET%"=="" ( echo [ERROR] Unknown argument: %1 & exit /b 1 )
set TARGET=%1
shift
goto :parse_args
:done_parsing

IF "%NOCACHE%"=="" (
    echo [build] Using layer cache ^(fast mode^). Use --fresh to force full rebuild.
) ELSE (
    echo [build] --fresh: ignoring cache. This will take 10-15 minutes for stt.
)

REM ── Pre-build validation ──────────────────────────────────────────────────────
echo.
echo [build] Running pre-build validation...
python validate.py
IF ERRORLEVEL 1 (
    echo.
    echo [build] Fix the errors above before building.
    echo [build] No Docker images were touched.
    exit /b 1
)
echo.
REM ── TLS certificates ─────────────────────────────────────────────────────────
echo [build] Checking TLS certificates...
IF NOT EXIST "nginx\certs\server.crt" (
    echo [build] Generating self-signed TLS certificate for local dev...
    docker run --rm -v "%cd%\nginx\certs:/certs" alpine sh -c ^
        "apk add --no-cache openssl && openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /certs/server.key -out /certs/server.crt -subj '/CN=localhost'"
    echo [build] Certificate generated.
) ELSE (
    echo [build] TLS certificate already exists, skipping.
)

REM ── Single service shortcut ───────────────────────────────────────────────────
IF NOT "%TARGET%"=="" (
    echo [build] Building only: %TARGET% %NOCACHE%
    docker compose build %NOCACHE% %TARGET%
    IF ERRORLEVEL 1 ( echo [ERROR] %TARGET% build failed & exit /b 1 )
    goto :success
)

REM ── Full build (sequential to avoid OOM) ─────────────────────────────────────
echo [build] Step 1/5 — migrate
docker compose build %NOCACHE% migrate
IF ERRORLEVEL 1 ( echo [ERROR] migrate build failed & exit /b 1 )

echo [build] Step 2/5 — auth
docker compose build %NOCACHE% auth
IF ERRORLEVEL 1 ( echo [ERROR] auth build failed & exit /b 1 )

echo [build] Step 3/5 — session
docker compose build %NOCACHE% session
IF ERRORLEVEL 1 ( echo [ERROR] session build failed & exit /b 1 )

echo [build] Step 4/5 — query
docker compose build %NOCACHE% query
IF ERRORLEVEL 1 ( echo [ERROR] query build failed & exit /b 1 )

echo [build] Step 5/5 — stt  (heaviest — torch + pyannote, allow 10-15 min for --fresh)
docker compose build %NOCACHE% stt
IF ERRORLEVEL 1 ( echo [ERROR] stt build failed & exit /b 1 )

:success
echo.
echo [build] Done. Run: docker compose up

endlocal
