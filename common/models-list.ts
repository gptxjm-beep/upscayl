export const MODELS = {
  "upscayl-standard-4x": {
    id: "upscayl-standard-4x",
    nativeScale: 4,
  },
  "upscayl-lite-4x": {
    id: "upscayl-lite-4x",
    nativeScale: 4,
  },
  "high-fidelity-4x": {
    id: "high-fidelity-4x",
    nativeScale: 4,
  },
  "remacri-4x": {
    id: "remacri-4x",
    nativeScale: 4,
  },
  "ultramix-balanced-4x": {
    id: "ultramix-balanced-4x",
    nativeScale: 4,
  },
  "ultrasharp-4x": {
    id: "ultrasharp-4x",
    nativeScale: 4,
  },
  "digital-art-4x": {
    id: "digital-art-4x",
    nativeScale: 4,
  },
};

export type ModelId = keyof typeof MODELS;
