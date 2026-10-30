#!/usr/bin/env sh
# Simulates an IP camera: pushes a test pattern (or SAMPLE=<file.mp4>) as RTSP into MediaMTX.
# Usage: SOURCE_PASSWORD=<MEDIA_SECRET> ./simulate_camera.sh [room_1]
set -e
ROOM="${1:-room_1}"
SECRET="${SOURCE_PASSWORD:-${MEDIA_SECRET:-devmedia}}"
if [ -n "$SAMPLE" ]; then SRC="-stream_loop -1 -i $SAMPLE"; else SRC="-f lavfi -re -i testsrc2=size=1280x720:rate=25"; fi
echo "Publishing room '$ROOM' to rtsp://localhost:8554/$ROOM"
exec ffmpeg -hide_banner -loglevel warning $SRC \
  -c:v libx264 -preset veryfast -tune zerolatency -g 50 -pix_fmt yuv420p \
  -f rtsp -rtsp_transport tcp "rtsp://publish:$SECRET@localhost:8554/$ROOM"
