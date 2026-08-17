import fs from "fs";
import path from "path";

// Config file stored in BearthApi root — persists the layers folder path across restarts.
// Priority: config file → LAYERS_DIR env var → cwd()/layers (fallback)
const CFG = path.resolve(process.cwd(), ".layers-config.json");

export function getLayersDir(): string {
  try {
    if (fs.existsSync(CFG)) {
      const { layersDir } = JSON.parse(fs.readFileSync(CFG, "utf8"));
      if (layersDir && typeof layersDir === "string") return layersDir;
    }
  } catch { }
  return process.env.LAYERS_DIR ?? path.resolve(process.cwd(), "layers");
}

export function setLayersDir(dir: string): void {
  fs.writeFileSync(CFG, JSON.stringify({ layersDir: dir }), "utf8");
}
