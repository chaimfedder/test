#!/bin/bash
# Join the three rendered shots (30 fps) with short cross-fades, upscale to 1080p, no audio.
set -e
cd "$(dirname "$0")"
n() { ls frames/$1/*.png | wc -l; }
dO=$(python3 -c "print($(n open)/30)"); dB=$(python3 -c "print($(n build)/30)"); dP=$(python3 -c "print($(n pack)/30)")
X=0.5
o1=$(python3 -c "print($dO-$X)"); o2=$(python3 -c "print($dO+$dB-2*$X)"); T=$(python3 -c "print($dO+$dB+$dP-2*$X)")
fo=$(python3 -c "print($T-0.7)")
ffmpeg -y -v error \
 -framerate 30 -i frames/open/%04d.png -framerate 30 -i frames/build/%04d.png -framerate 30 -i frames/pack/%04d.png \
 -filter_complex "[0]scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1[a];[1]scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1[b];[2]scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1[c];[a][b]xfade=transition=fade:duration=$X:offset=$o1[ab];[ab][c]xfade=transition=fade:duration=$X:offset=$o2,fade=t=in:st=0:d=0.5,fade=t=out:st=$fo:d=0.7[v]" \
 -map "[v]" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart ../out/hat_bags_short.mp4
echo "total $T s"
