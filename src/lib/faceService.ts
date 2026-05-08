import path from "path";
import { createRequire } from "module";
import { logger } from "./logger";

const require = createRequire(import.meta.url);

// Use the models bundled with @vladmandic/face-api — no download needed
const FACE_API_PKG = require.resolve("@vladmandic/face-api/package.json");
const MODEL_DIR = path.join(path.dirname(FACE_API_PKG), "model");

let initialized = false;
let initPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let faceapi: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let canvasModule: any = null;

export async function initFaceService(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    logger.info("Initializing face service...");

    // Use the node-wasm build — runs WASM TF backend in Node.js,
    // avoiding @tensorflow/tfjs-node@4.22 incompatibilities.
    const [faceApiModule, canvas] = await Promise.all([
      import("@vladmandic/face-api/dist/face-api.node-wasm.js"),
      import("canvas"),
    ]);

    faceapi = faceApiModule;
    canvasModule = canvas;

    // WASM backend must be fully initialized before any tensor ops.
    // face-api exposes the underlying tf instance it uses.
    if (typeof faceapi.tf?.ready === "function") {
      await faceapi.tf.ready();
    }

    const { Canvas, Image, ImageData } = canvasModule;

    faceapi.env.monkeyPatch({
      Canvas: Canvas as unknown as typeof HTMLCanvasElement,
      Image: Image as unknown as typeof HTMLImageElement,
      ImageData: ImageData as unknown as typeof globalThis.ImageData,
    });

    await faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_DIR);
    await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(MODEL_DIR);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);

    initialized = true;
    logger.info("Face service ready");
  })();

  return initPromise;
}

export function isFaceServiceReady(): boolean {
  return initialized;
}

export async function detectFaceDescriptor(
  imageBase64: string,
): Promise<Float32Array | null> {
  if (!initialized) {
    throw new Error("Face service not initialized");
  }

  const { loadImage } = canvasModule;
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const img = await loadImage(buffer);

  const detection = await faceapi
    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  return detection?.descriptor ?? null;
}

const MATCH_THRESHOLD_SCORE = 60;

export function scoreFaces(
  stored: number[],
  live: Float32Array,
): { distance: number; matchScore: number; isMatch: boolean } {
  const distance: number = faceapi.euclideanDistance(
    stored as unknown as Float32Array,
    live,
  );
  const matchScore = Math.round(Math.max(0, Math.min(100, (1 - distance) * 100)));
  return {
    distance: parseFloat(distance.toFixed(4)),
    matchScore,
    isMatch: matchScore >= MATCH_THRESHOLD_SCORE,
  };
}
