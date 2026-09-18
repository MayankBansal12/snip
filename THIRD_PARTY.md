# Third-party software

- React and React DOM — MIT.
- Lucide icons — ISC.
- Inter variable font — SIL Open Font License 1.1. Bundled locally via @fontsource-variable/inter; [license](public/licenses/Inter-OFL.txt).
- @ffmpeg/ffmpeg — MIT; https://github.com/ffmpegwasm/ffmpeg.wasm
- @ffmpeg/core 0.12.10 — GPL-2.0-or-later. The bundled `public/ffmpeg/ffmpeg-core.js` and `.wasm` are unmodified single-threaded build artifacts from this package. FFmpeg, x264, libvpx, and other codec components retain their upstream licenses.

FFmpeg WebAssembly source and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm

GPL v2 license text: [public/licenses/ffmpeg-GPL-2.0.txt](public/licenses/ffmpeg-GPL-2.0.txt)

Dependencies and exact versions are recorded in package-lock.json. The worker, const, and errors modules in `public/ffmpeg` are unmodified artifacts from @ffmpeg/ffmpeg 0.12.15.
