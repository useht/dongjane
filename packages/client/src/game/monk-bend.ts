import { MeshDepthMaterial, MeshLambertMaterial, Vector3 } from "three";
import rig from "../../assets/monk/monk-rig.json";

// The one bend the jacket takes when a monk bows, a copy of bend_vertex in packages/client/assets/monk/build_monk.py (which checks the
// whole bow against it; test/monk-bend.test.ts holds this copy to the numbers that script writes). It works in the waist frame, with
// h the height (three.js's y), f the forward distance (-z) and x untouched. Below the base (h = -BEND_LENGTH) nothing moves; from there
// up to the hinge (h = 0) the jacket curves forward at the constant rate theta / BEND_LENGTH about the axis f = BEND_FORWARD; above the
// hinge the chest is one rigid body that keeps the curve's end tangent (bendFrame).
export const BEND_LENGTH = rig.bendLength;
export const BEND_FORWARD = rig.bendForward;
const STRAIGHT = 1e-4;

// Where the upright point `point` of the jacket goes at the bow angle `theta`. Below the hinge it is first shortened by the gather
// (1 standing, less when the jacket is gathered over the thighs of a kneeling or seated monk).
export function bendPoint(point: Vector3, theta: number, gather: number, out: Vector3): Vector3 {
  const f = -point.z;
  const h = point.y < 0 ? point.y * gather : point.y;
  if (theta < STRAIGHT) return out.set(point.x, h, -f);
  const u = h + BEND_LENGTH;
  const s = Math.min(Math.max(u, 0), BEND_LENGTH);
  const o = f - BEND_FORWARD;
  const k = theta / BEND_LENGTH;
  const phi = k * s;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  return out.set(
    point.x,
    -BEND_LENGTH + sn / k - o * sn + (u - s) * c,
    -(BEND_FORWARD + (1 - c) / k + o * c + (u - s) * sn),
  );
}

// The shading normal of the upright point `point` once bent: the normal turns with the curve, and the front, which the bend
// compresses, tilts the way a surface does that is squeezed along the axis.
export function bendNormal(point: Vector3, normal: Vector3, theta: number, gather: number, out: Vector3): Vector3 {
  const f = -point.z;
  const below = point.y < 0;
  const h = below ? point.y * gather : point.y;
  const nh = below ? normal.y / gather : normal.y;
  const nf = -normal.z;
  if (theta < STRAIGHT) return out.set(normal.x, nh, -nf).normalize();
  const u = h + BEND_LENGTH;
  const s = Math.min(Math.max(u, 0), BEND_LENGTH);
  const o = f - BEND_FORWARD;
  const k = theta / BEND_LENGTH;
  const phi = k * s;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const stretch = u > 0 && u < BEND_LENGTH ? 1 - k * o : 1;
  const ns = nh / stretch;
  return out.set(normal.x, -nf * sn + ns * c, -(nf * c + ns * sn)).normalize();
}

const ORIGIN = new Vector3();

// Where the bend puts the hinge (the waist pivot): the origin of the frame of the head and shoulders, which is also turned forward
// by theta (rotation.x = -theta) and rides on the waist.
export function bendFrame(theta: number, out: Vector3): Vector3 {
  return bendPoint(ORIGIN.set(0, 0, 0), theta, 1, out);
}

// Floats written for GLSL need a decimal point (or an exponent): 0.2 stays 0.2, 1 becomes 1.0.
function glslFloat(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

// The same bend as bendPoint and bendNormal, per vertex in the vertex shader: monks are InstancedMeshes that share one geometry per
// part, so each instance carries its own bend as the attribute instanceBend (theta, gather).
const BEND_PARS = /* glsl */ `
attribute vec2 instanceBend;

const float BEND_LENGTH = ${glslFloat(BEND_LENGTH)};
const float BEND_FORWARD = ${glslFloat(BEND_FORWARD)};

vec3 bendPoint( vec3 p, float theta, float gather ) {
	float f = - p.z;
	float h = p.y < 0.0 ? p.y * gather : p.y;
	if ( theta < ${glslFloat(STRAIGHT)} ) return vec3( p.x, h, - f );
	float u = h + BEND_LENGTH;
	float s = clamp( u, 0.0, BEND_LENGTH );
	float o = f - BEND_FORWARD;
	float k = theta / BEND_LENGTH;
	float phi = k * s;
	float c = cos( phi );
	float sn = sin( phi );
	return vec3(
		p.x,
		- BEND_LENGTH + sn / k - o * sn + ( u - s ) * c,
		- ( BEND_FORWARD + ( 1.0 - c ) / k + o * c + ( u - s ) * sn )
	);
}

vec3 bendNormal( vec3 p, vec3 n, float theta, float gather ) {
	float f = - p.z;
	bool below = p.y < 0.0;
	float h = below ? p.y * gather : p.y;
	float nh = below ? n.y / gather : n.y;
	float nf = - n.z;
	if ( theta < ${glslFloat(STRAIGHT)} ) return normalize( vec3( n.x, nh, - nf ) );
	float u = h + BEND_LENGTH;
	float s = clamp( u, 0.0, BEND_LENGTH );
	float o = f - BEND_FORWARD;
	float k = theta / BEND_LENGTH;
	float phi = k * s;
	float c = cos( phi );
	float sn = sin( phi );
	float stretch = ( u > 0.0 && u < BEND_LENGTH ) ? 1.0 - k * o : 1.0;
	float ns = nh / stretch;
	return normalize( vec3( n.x, - nf * sn + ns * c, - ( nf * c + ns * sn ) ) );
}
`;

const BEND_POINT = "transformed = bendPoint( transformed, instanceBend.x, instanceBend.y );";
const BEND_NORMAL = "objectNormal = bendNormal( position, objectNormal, instanceBend.x, instanceBend.y );";

function after(source: string, include: string, code: string): string {
  const at = source.indexOf(include);
  if (at < 0) throw new Error(`monk bend: the shader has no ${include}`);
  return source.slice(0, at + include.length) + "\n" + code + source.slice(at + include.length);
}

export function bendVertexShader(source: string, withNormal: boolean): string {
  const bent = after(source, "#include <common>", BEND_PARS);
  const moved = after(bent, "#include <begin_vertex>", BEND_POINT);
  return withNormal ? after(moved, "#include <beginnormal_vertex>", BEND_NORMAL) : moved;
}

// The lit material bends the points and the normals; the depth material the shadow pass draws with bends only the points, and must
// be set as the mesh's customDepthMaterial, or the shadow stays upright while the monk bows.
export function bentMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = bendVertexShader(shader.vertexShader, true);
  };
  material.customProgramCacheKey = () => "monk-bend";
  return material;
}

export function bentDepthMaterial(): MeshDepthMaterial {
  const material = new MeshDepthMaterial();
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = bendVertexShader(shader.vertexShader, false);
  };
  material.customProgramCacheKey = () => "monk-bend-depth";
  return material;
}
