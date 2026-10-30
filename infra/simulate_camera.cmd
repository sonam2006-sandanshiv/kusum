@echo off
rem Simulates an IP camera (test pattern, or set SAMPLE=path\to\clip.mp4).
rem Usage: simulate_camera.cmd [room_1]
setlocal
set ROOM=%1
if "%ROOM%"=="" set ROOM=room_1
if "%SOURCE_PASSWORD%"=="" if not "%MEDIA_SECRET%"=="" set SOURCE_PASSWORD=%MEDIA_SECRET%
if "%SOURCE_PASSWORD%"=="" set SOURCE_PASSWORD=devmedia
if "%SAMPLE%"=="" (
  set SRC=-f lavfi -re -i testsrc2=size=1280x720:rate=25
) else (
  set SRC=-stream_loop -1 -i %SAMPLE%
)
echo Publishing room "%ROOM%" to rtsp://localhost:8554/%ROOM%
ffmpeg -hide_banner -loglevel warning %SRC% -c:v libx264 -preset veryfast -tune zerolatency -g 50 -pix_fmt yuv420p -f rtsp -rtsp_transport tcp "rtsp://publish:%SOURCE_PASSWORD%@localhost:8554/%ROOM%"
