import argparse
import base64
import json
import os
import sys
import wave
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import soundfile as sf
import websocket
from openai import OpenAI


# -------------------------
# Helpers
# -------------------------

def require_api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("Missing OPENAI_API_KEY env var.")
    return key


def print_err(*args):
    print(*args, file=sys.stderr)


def linear_resample_mono(x: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Simple linear resampler (MVP-quality)."""
    if src_rate == dst_rate:
        return x.astype(np.float32)

    if x.size == 0:
        return x.astype(np.float32)

    duration = x.size / float(src_rate)
    dst_len = int(round(duration * dst_rate))
    src_idx = np.arange(x.size, dtype=np.float32)
    dst_idx = np.linspace(0, x.size - 1, num=dst_len, dtype=np.float32)
    y = np.interp(dst_idx, src_idx, x).astype(np.float32)
    return y


def float32_to_pcm16_bytes(x: np.ndarray) -> bytes:
    """Float32 [-1,1] -> little-endian signed 16-bit PCM bytes."""
    x = np.clip(x, -1.0, 1.0)
    ints = (x * 32767.0).astype(np.int16)
    return ints.tobytes()


def pcm16_bytes_to_wav(path: str, pcm16: bytes, rate: int, channels: int = 1):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(rate)
        wf.writeframes(pcm16)


# -------------------------
# STT (Speech-to-Text)
# -------------------------

def cmd_stt(args):
    client = OpenAI()  # reads OPENAI_API_KEY from env
    with open(args.file, "rb") as f:
        tx = client.audio.transcriptions.create(
            model=args.model,
            file=f,
            response_format=args.response_format,
        )

    # Some formats return objects with .text, others return richer JSON.
    if hasattr(tx, "text"):
        print(tx.text)
    else:
        print(tx)


# -------------------------
# TTS (Text-to-Speech)
# -------------------------

def cmd_tts(args):
    client = OpenAI()
    # Streaming-to-file is the simplest way to avoid buffering huge audio in memory.
    kwargs = {
        "model": args.model,
        "voice": args.voice,
        "input": args.text,
        "response_format": args.format,
    }
    if args.instructions is not None:
        kwargs["instructions"] = args.instructions
    
    with client.audio.speech.with_streaming_response.create(**kwargs) as resp:
        resp.stream_to_file(args.out)

    print(f"Wrote: {args.out}")


# -------------------------
# Realtime (WebSocket)
# -------------------------

REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime"


@dataclass
class RealtimeConfig:
    output_modalities: Tuple[str, ...] = ("text",)
    voice: str = "marin"
    input_rate: int = 24000
    output_format: str = "audio/pcm"  # easiest to write to WAV


def ws_connect() -> websocket.WebSocket:
    key = require_api_key()
    headers = [f"Authorization: Bearer {key}"]
    ws = websocket.create_connection(REALTIME_URL, header=headers)
    return ws


def ws_recv_json(ws: websocket.WebSocket) -> dict:
    msg = ws.recv()
    return json.loads(msg)


def ws_send_json(ws: websocket.WebSocket, obj: dict):
    ws.send(json.dumps(obj))


def cmd_realtime_text(args):
    ws = ws_connect()
    try:
        # Wait for server session.created (or any first event)
        first = ws_recv_json(ws)
        print_err("Connected. First event:", first.get("type"))

        # Send a user text message
        ws_send_json(ws, {
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": args.prompt}],
            },
        })

        # Ask model to respond (stream text)
        ws_send_json(ws, {
            "type": "response.create",
            "response": {"output_modalities": ["text"]},
        })

        # Stream deltas until response.done
        while True:
            ev = ws_recv_json(ws)
            t = ev.get("type", "")
            if t == "response.output_text.delta":
                # Typical field name for text chunks is "delta"
                sys.stdout.write(ev.get("delta", ""))
                sys.stdout.flush()
            elif t == "response.done":
                print()  # newline
                break
    finally:
        ws.close()


def cmd_realtime_audio(args):
    """
    Sends a WAV file as audio input (PCM16 @ 24k), then saves model audio output to out.wav.
    For MVP simplicity, we:
      - resample to 24k mono
      - send audio via input_audio_buffer.append + commit
      - request output modalities ["text","audio"]
      - collect output_audio.delta chunks and write to a WAV
    """
    ws = ws_connect()
    out_pcm = bytearray()
    got_text = []

    try:
        first = ws_recv_json(ws)
        print_err("Connected. First event:", first.get("type"))

        # Read WAV (or any audio soundfile supports), convert to mono float32
        data, sr = sf.read(args.wav, dtype="float32")
        if data.ndim > 1:
            data = data[:, 0]  # mono
        data = linear_resample_mono(data, sr, 24000)
        pcm16 = float32_to_pcm16_bytes(data)

        # Configure session: request both text + audio, set formats, disable auto turn detection (push-to-talk)
        # Event schema follows the realtime conversations guide.
        ws_send_json(ws, {
            "type": "session.update",
            "session": {
                "type": "realtime",
                "model": "gpt-realtime",
                "output_modalities": ["text", "audio"],
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "turn_detection": None,
                    },
                    "output": {
                        "format": {"type": "audio/pcm"},
                        "voice": args.voice,
                    },
                },
                "instructions": args.instructions,
            },
        })

        # Clear any old buffered audio (safe)
        ws_send_json(ws, {"type": "input_audio_buffer.clear"})

        # Chunk and send audio (base64). Keep chunks reasonably sized.
        chunk_bytes = 32000  # ~0.66s @ 24kHz * 2 bytes
        for i in range(0, len(pcm16), chunk_bytes):
            chunk = pcm16[i:i + chunk_bytes]
            b64 = base64.b64encode(chunk).decode("ascii")
            ws_send_json(ws, {"type": "input_audio_buffer.append", "audio": b64})

        # Commit buffer => creates user audio item; then request response
        ws_send_json(ws, {"type": "input_audio_buffer.commit"})
        ws_send_json(ws, {"type": "response.create", "response": {"output_modalities": ["text", "audio"]}})

        print_err("Streaming response...")

        while True:
            ev = ws_recv_json(ws)
            t = ev.get("type", "")

            # Text deltas
            if t == "response.output_text.delta":
                got_text.append(ev.get("delta", ""))
                sys.stdout.write(ev.get("delta", ""))
                sys.stdout.flush()

            # Audio deltas (docs mention response.output_audio.delta; some older snippets use response.audio.delta)
            if t in ("response.output_audio.delta", "response.audio.delta"):
                b64 = ev.get("delta") or ev.get("audio") or ""
                if b64:
                    out_pcm.extend(base64.b64decode(b64))

            if t == "response.done":
                print()  # newline
                break

        pcm16_bytes_to_wav(args.out, bytes(out_pcm), rate=24000, channels=1)
        print_err(f"Saved model audio to: {args.out}")

    finally:
        ws.close()


# -------------------------
# CLI
# -------------------------

def main():
    p = argparse.ArgumentParser(description="OpenAI STT / TTS / Realtime MVP tester")
    sub = p.add_subparsers(dest="cmd", required=True)

    # STT
    p_stt = sub.add_parser("stt", help="Speech-to-text from an audio file")
    p_stt.add_argument("--file", required=True, help="Path to audio file (mp3/wav/m4a/...)")
    p_stt.add_argument("--model", default="gpt-4o-mini-transcribe", help="e.g. gpt-4o-transcribe")
    p_stt.add_argument("--response-format", default="text", help="text/json/verbose_json/etc")
    p_stt.set_defaults(func=cmd_stt)

    # TTS
    p_tts = sub.add_parser("tts", help="Text-to-speech to an output file")
    p_tts.add_argument("--text", required=True, help="Text to speak")
    p_tts.add_argument("--out", default="speech.mp3", help="Output file path")
    p_tts.add_argument("--model", default="gpt-4o-mini-tts")
    p_tts.add_argument("--voice", default="marin", help="e.g. alloy/coral/marin/cedar...")
    p_tts.add_argument("--format", default="mp3", help="mp3/wav/pcm/opus/aac/flac")
    p_tts.add_argument("--instructions", default=None, help="Optional speaking style guidance")
    p_tts.set_defaults(func=cmd_tts)

    # Realtime text
    p_rt = sub.add_parser("realtime-text", help="Realtime over WebSocket (text in, text out)")
    p_rt.add_argument("--prompt", required=True, help="What to ask")
    p_rt.set_defaults(func=cmd_realtime_text)

    # Realtime audio
    p_rta = sub.add_parser("realtime-audio", help="Realtime over WebSocket (wav in, text+audio out)")
    p_rta.add_argument("--wav", required=True, help="Input WAV (any rate; will be resampled to 24k mono)")
    p_rta.add_argument("--out", default="realtime_out.wav", help="Output WAV path")
    p_rta.add_argument("--voice", default="marin")
    p_rta.add_argument("--instructions", default="Be concise and helpful.")
    p_rta.set_defaults(func=cmd_realtime_audio)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
