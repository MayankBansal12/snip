# Third-party software

- React and React DOM — MIT.
- coss UI — MIT. Official registry sources copied into `src/components/ui` with their original styles; [license](public/licenses/coss-MIT.txt). Source: https://github.com/cosscom/coss
- Base UI, Tailwind CSS, class-variance-authority, clsx, tailwind-merge, and tw-animate-css — MIT.
- Lucide icons — ISC.
- Inter variable font — SIL Open Font License 1.1. Bundled locally via @fontsource-variable/inter; [license](public/licenses/Inter-OFL.txt).
- @ffmpeg/ffmpeg — MIT; https://github.com/ffmpegwasm/ffmpeg.wasm
- @ffmpeg/core and @ffmpeg/core-mt 0.12.10 — GPL-2.0-or-later. The bundled assets in `public/ffmpeg` and `public/ffmpeg/mt` are unmodified single-threaded and multithreaded build artifacts from these packages. FFmpeg, x264, libvpx, and other codec components retain their upstream licenses.

- Mediabunny 1.58.1 — MPL-2.0, used unmodified; [license](public/licenses/mediabunny-MPL-2.0.txt). Source: https://github.com/Vanilagy/mediabunny

FFmpeg WebAssembly source and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm

GPL v2 license text: [public/licenses/ffmpeg-GPL-2.0.txt](public/licenses/ffmpeg-GPL-2.0.txt)

Dependencies and exact versions are recorded in package-lock.json. The worker, const, and errors modules in `public/ffmpeg` are unmodified artifacts from @ffmpeg/ffmpeg 0.12.15.
