# Optional local speech recognition

The optional download uses Transformers.js 3.8.1 and ONNX Runtime Web. Transformers.js is distributed under Apache 2.0 and ONNX Runtime under MIT; their license texts are in `licenses/`. The application downloads the official browser runtime from the pinned npm package via jsDelivr and verifies its SHA-256 checksums before use. Source: [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js).

The model is the multilingual [Xenova/whisper-tiny](https://huggingface.co/Xenova/whisper-tiny) ONNX conversion, identified there as Apache 2.0, pinned to revision `5332fcc35e32a33b86612b9a57a89be7906102b1`. The original [OpenAI Whisper](https://github.com/openai/whisper) code and weights are distributed under the MIT license. The model's quantized encoder and decoder are checked against their upstream SHA-256 values; its configuration and tokenizer files are checked against the pinned Git blob IDs. Files and checksums are listed in `speech-model.js`.

These links identify the source of the optional files. The download is started only by an explicit user or agent action. The model and runtime are then served by the RoomSuite server; audio and transcriptions are processed on the requesting device, without uploading them to the download hosts.
