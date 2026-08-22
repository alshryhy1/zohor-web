@echo off
setlocal

set APP_HOME=%~dp0
set GRADLE_VERSION=8.11.1

if "%GRADLE_USER_HOME%"=="" (
  set GRADLE_USER_HOME=%USERPROFILE%\.gradle
)

set DIST_DIR=%GRADLE_USER_HOME%\zohor-wrapper
set GRADLE_HOME=%DIST_DIR%\gradle-%GRADLE_VERSION%

if not exist "%GRADLE_HOME%\bin\gradle.bat" (
  echo Gradle %GRADLE_VERSION% is not installed for this lightweight wrapper.
  echo Please install Gradle or run apps\android\gradlew from macOS/Linux to download it.
  exit /b 1
)

"%GRADLE_HOME%\bin\gradle.bat" -p "%APP_HOME%" %*
