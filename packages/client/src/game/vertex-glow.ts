import { MeshLambertMaterial } from "three";

// A lit material that also gives off light: the emissive colour is multiplied by the vertex colours, so a paper
// lantern or a painted wall glows in the tint it was painted with rather than in one flat colour.
export function vertexGlowMaterial(emissive: string, intensity: number): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true, emissive, emissiveIntensity: intensity });
  material.onBeforeCompile = (shader): void => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;");
  };
  material.customProgramCacheKey = (): string => "vertex-glow";
  return material;
}
