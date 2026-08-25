# MOV and MP4 HLS Transcode Benchmark

Date: 2026-08-24

## Source

- MP4 source: generated from FFmpeg `testsrc2` with H.264 video and AAC audio.
- MOV source: remuxed from the MP4 source with `-c copy`.
- Duration: 8 seconds
- Resolution: 1920x1080
- Frame rate: 30 fps
- Video codec: H.264
- Audio codec: AAC

This keeps duration, resolution, frame rate, and codecs equivalent so the benchmark compares container handling rather than source media complexity.

## FFmpeg Profile

- Profile: `adaptive-1080p`
- Processing method: CPU `libx264`, no hardware acceleration flags
- Preset: `medium`
- Video: H.264 high profile, level 4.1, `yuv420p`, 5000k target, 5350k maxrate, 7500k bufsize
- Audio: AAC, 48 kHz, stereo, 128k
- HLS: 4 second VOD segments, independent segments

## Results

| Container | Total transcode time | Average speed | Output size |
| --- | ---: | ---: | ---: |
| MP4 | 9.181 seconds | 0.886x | 5,303,505 bytes |
| MOV | 7.644 seconds | 1.07x | 5,280,381 bytes |

The measured MOV file was slightly faster in this local run, but the result should not be generalized to all MOV uploads. Processing time depends on source codec, bitrate, frame rate, duration, hardware, and whether streams can be copied or must be re-encoded.

## HLS Command

```sh
ffmpeg -hide_banner -y -nostats -progress pipe:1 -i INPUT_FILE \
  -map 0:v:0 -map 0:a:0? -dn -sn \
  -c:v libx264 -preset medium -profile:v high -level:v 4.1 \
  -pix_fmt yuv420p \
  -vf scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2 \
  -r 30 -g 120 -keyint_min 120 -sc_threshold 0 \
  -force_key_frames expr:gte(t,n_forced*4) \
  -b:v 5000k -maxrate 5350k -bufsize 7500k -threads 0 \
  -c:a aac -ar 48000 -ac 2 -b:a 128k \
  -hls_time 4 -hls_playlist_type vod -hls_list_size 0 \
  -hls_flags independent_segments \
  -hls_segment_filename OUTPUT_DIR/segment_%06d.ts \
  -f hls OUTPUT_DIR/index.m3u8
```
