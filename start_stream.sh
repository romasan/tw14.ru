#!/bin/bash

IMAGE_PATH=$1
AUDIO_STREAM_URL=$2
RTMP_URL=$3

ffmpeg -framerate 15 -re -loop 1 -i "$IMAGE_PATH" -i "$AUDIO_STREAM_URL" \
    -vcodec libx264 -preset veryfast -pix_fmt yuv420p -r 15 -g 30 \
    -b:v 500k -s 640x360 -f flv "$RTMP_URL"
